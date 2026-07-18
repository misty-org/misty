package api

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	serveragent "github.com/kannachi323/misty/server/agent"
	"github.com/kannachi323/misty/server/db"
	"github.com/kannachi323/misty/server/security"
)

type SpacesService struct {
	database *db.Database
	agent    *serveragent.Service
	library  *SpaceLibraryService
	aead     cipher.AEAD
	keyVer   int16
	workers  sync.Once
}

func NewSpacesService(database *db.Database, agent *serveragent.Service, encryptionKey string) (*SpacesService, error) {
	key, err := parseSpaceEncryptionKey(encryptionKey)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &SpacesService{database: database, agent: agent, aead: aead, keyVer: 1}, nil
}

// SetLibraryProvider installs the server-side Library provider used by Agent
// workflow actions. Connections and authorization still come from the run's
// requesting user; the provider is only the byte/object transport.
func (s *SpacesService) SetLibraryProvider(library *SpaceLibraryService) {
	s.library = library
}

func parseSpaceEncryptionKey(value string) ([]byte, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, errors.New("space link encryption key is required")
	}
	if decoded, err := base64.StdEncoding.DecodeString(value); err == nil && len(decoded) == 32 {
		return decoded, nil
	}
	if decoded, err := hex.DecodeString(value); err == nil && len(decoded) == 32 {
		return decoded, nil
	}
	if len(value) == 32 {
		return []byte(value), nil
	}
	return nil, errors.New("space link encryption key must be 32 bytes, base64, or hexadecimal")
}

func (s *SpacesService) encryptTarget(target string) ([]byte, []byte, error) {
	nonce := make([]byte, s.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, nil, err
	}
	return s.aead.Seal(nil, nonce, []byte(target), []byte("misty-space-link-v1")), nonce, nil
}

func (s *SpacesService) decryptTarget(ciphertext, nonce []byte) (string, error) {
	plaintext, err := s.aead.Open(nil, nonce, ciphertext, []byte("misty-space-link-v1"))
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}

func validGoogleDriveTarget(raw string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme != "https" || parsed.User != nil || parsed.Host == "" {
		return nil, db.ErrSpaceInvalid
	}
	host := strings.ToLower(parsed.Hostname())
	allowed := host == "drive.google.com" || host == "docs.google.com" || host == "drive.usercontent.google.com" || host == "lh3.googleusercontent.com" || strings.HasSuffix(host, ".googleusercontent.com")
	if !allowed {
		return nil, db.ErrSpaceInvalid
	}
	parsed.Fragment = ""
	return parsed, nil
}

func authenticatedUser(w http.ResponseWriter, r *http.Request, database *db.Database) (string, bool) {
	userID, err := sessionUserID(r, database)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"code": "internal_error"})
		return "", false
	}
	if userID == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"code": "not_authenticated"})
		return "", false
	}
	return userID, true
}

func writeSpaceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, db.ErrSpaceNotFound), errors.Is(err, db.ErrSpaceInviteNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"code": "not_found"})
	case errors.Is(err, db.ErrSpaceForbidden), errors.Is(err, db.ErrLibraryForbidden):
		writeJSON(w, http.StatusForbidden, map[string]string{"code": "forbidden"})
	case errors.Is(err, db.ErrWorkflowIntegrationRequired):
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{"code": "integration_required"})
	case errors.Is(err, db.ErrSpaceLimit):
		writeJSON(w, http.StatusConflict, map[string]string{"code": "space_limit_reached"})
	case errors.Is(err, db.ErrSpaceOwnershipLimit):
		writeJSON(w, http.StatusConflict, map[string]string{"code": "space_ownership_limit_reached"})
	case errors.Is(err, db.ErrSpacePeopleLimit):
		writeJSON(w, http.StatusConflict, map[string]string{"code": "space_people_limit_reached"})
	case errors.Is(err, db.ErrSpaceNodeLimit):
		writeJSON(w, http.StatusConflict, map[string]string{"code": "space_node_limit_reached"})
	case errors.Is(err, db.ErrSpaceConflict):
		writeJSON(w, http.StatusConflict, map[string]string{"code": "version_conflict"})
	case errors.Is(err, db.ErrSpaceInviteExpired):
		writeJSON(w, http.StatusGone, map[string]string{"code": "invite_expired"})
	case errors.Is(err, db.ErrSpaceInvalid), errors.Is(err, db.ErrLibraryInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]string{"code": "invalid_request"})
	default:
		writeJSON(w, http.StatusInternalServerError, map[string]string{"code": "internal_error"})
	}
}

func (s *SpacesService) Spaces() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		switch r.Method {
		case http.MethodGet:
			spaces, err := s.database.ListSpaces(r.Context(), userID)
			if err != nil {
				writeSpaceError(w, err)
				return
			}
			invites, err := s.database.IncomingSpaceInvites(r.Context(), userID)
			if err != nil {
				writeSpaceError(w, err)
				return
			}
			owned := 0
			for _, space := range spaces {
				if space.OwnerUserID == userID {
					owned++
				}
			}
			remaining := db.MaxOwnedSpacesPerUser - owned
			if remaining < 0 {
				remaining = 0
			}
			writeJSON(w, http.StatusOK, map[string]any{"spaces": spaces, "invitations": invites, "limits": map[string]any{
				"owned": owned, "owned_limit": db.MaxOwnedSpacesPerUser, "remaining_owned": remaining,
				"memberships": db.MaxSpacesPerUser, "people": db.MaxSpacePeople, "nodes": db.MaxSpaceNodes,
				"space_storage_bytes": db.MaxSpaceStorageBytes,
			}})
		case http.MethodPost:
			var body struct {
				Name string `json:"name"`
			}
			if decodeJSON(w, r, &body) != nil {
				return
			}
			space, err := s.database.CreateSpace(r.Context(), userID, body.Name)
			if err != nil {
				writeSpaceError(w, err)
				return
			}
			writeJSON(w, http.StatusCreated, space)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

func (s *SpacesService) Space() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID := chi.URLParam(r, "spaceID")
		switch r.Method {
		case http.MethodGet:
			space, err := s.database.SpaceByID(r.Context(), userID, spaceID)
			if err != nil {
				writeSpaceError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, space)
		case http.MethodPatch, http.MethodPut:
			var body struct {
				Name string `json:"name"`
			}
			if decodeJSON(w, r, &body) != nil {
				return
			}
			space, err := s.database.RenameSpace(r.Context(), userID, spaceID, body.Name)
			if err != nil {
				writeSpaceError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, space)
		case http.MethodDelete:
			var body struct {
				Confirmation string `json:"confirmation"`
			}
			if decodeJSON(w, r, &body) != nil {
				return
			}
			if err := s.database.DeleteSpace(r.Context(), userID, spaceID, body.Confirmation); err != nil {
				writeSpaceError(w, err)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}
}

func (s *SpacesService) Members() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID := chi.URLParam(r, "spaceID")
		members, err := s.database.SpaceMembers(r.Context(), userID, spaceID)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"members": members})
	}
}

func (s *SpacesService) Invite() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		var body struct {
			Email string `json:"email"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		invite, err := s.database.InviteToSpace(r.Context(), userID, chi.URLParam(r, "spaceID"), body.Email)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, invite)
	}
}

func (s *SpacesService) RespondInvite(accept bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		space, err := s.database.RespondToSpaceInvite(r.Context(), userID, chi.URLParam(r, "inviteID"), accept)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		if !accept {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		writeJSON(w, http.StatusOK, space)
	}
}

func (s *SpacesService) RemoveMember() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		if err := s.database.RemoveSpaceMember(r.Context(), userID, chi.URLParam(r, "spaceID"), chi.URLParam(r, "userID")); err != nil {
			writeSpaceError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (s *SpacesService) LeaveSpace() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		if err := s.database.LeaveSpace(r.Context(), userID, chi.URLParam(r, "spaceID")); err != nil {
			writeSpaceError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (s *SpacesService) TransferOwner() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		var body struct {
			UserID string `json:"user_id"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		if err := s.database.TransferSpaceOwnership(r.Context(), userID, chi.URLParam(r, "spaceID"), body.UserID); err != nil {
			writeSpaceError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (s *SpacesService) Messages() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID := chi.URLParam(r, "spaceID")
		if r.Method == http.MethodGet {
			before, _ := strconv.ParseInt(r.URL.Query().Get("before"), 10, 64)
			limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
			messages, err := s.database.SpaceMessages(r.Context(), userID, spaceID, before, limit)
			if err != nil {
				writeSpaceError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"messages": messages})
			return
		}
		var body struct {
			Content          []db.MessageSpan `json:"content"`
			FileNodeIDs      []string         `json:"file_node_ids"`
			AttachmentIDs    []string         `json:"attachment_ids"`
			LibraryItemIDs   []string         `json:"library_item_ids"`
			ReplyToMessageID string           `json:"reply_to_message_id"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		message, agentIDs, err := s.database.CreateSpaceMessageWithReferences(r.Context(), userID, spaceID, body.Content, body.FileNodeIDs, body.AttachmentIDs, body.LibraryItemIDs, body.ReplyToMessageID)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		agentReplies := make([]*db.SpaceMessage, 0, len(agentIDs))
		agentFailures := make([]agentMentionFailure, 0)
		for _, agentID := range uniqueStrings(agentIDs) {
			reply, runErr := s.runMentionedAgent(r.Context(), userID, spaceID, "", agentID, message.ID, body.Content, body.FileNodeIDs)
			if runErr != nil {
				agentFailures = append(agentFailures, agentMentionFailureFromError(agentID, runErr))
			} else if reply != nil {
				agentReplies = append(agentReplies, reply)
			}
		}
		writeJSON(w, http.StatusCreated, map[string]any{"message": message, "agent_replies": agentReplies, "agent_failures": agentFailures})
	}
}

type agentMentionFailure struct {
	AgentID string `json:"agent_id"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

func agentMentionFailureFromError(agentID string, err error) agentMentionFailure {
	code, message := spaceRunFailureFromError(err)
	return agentMentionFailure{AgentID: agentID, Code: code, Message: message}
}

func spaceRunFailureFromError(err error) (string, string) {
	var exhausted serveragent.CreditsExhaustedError
	switch {
	case errors.Is(err, context.Canceled):
		return "request_canceled", "The run was canceled before it could start."
	case errors.As(err, &exhausted):
		return "credits_exhausted", "The run could not start because this account does not have enough AI credits."
	case errors.Is(err, db.ErrWorkflowIntegrationRequired):
		return "integration_required", "The run needs a required Space integration before it can start."
	case errors.Is(err, db.ErrLibraryForbidden), errors.Is(err, db.ErrSpaceForbidden):
		return "forbidden", "You no longer have permission to run this resource."
	case errors.Is(err, db.ErrAgentNotFound), errors.Is(err, db.ErrLibraryNotFound), errors.Is(err, db.ErrSpaceNotFound):
		return "resource_unavailable", "This resource is no longer available in the Space."
	case errors.Is(err, db.ErrSpaceInvalid), errors.Is(err, db.ErrLibraryInvalid):
		return "invalid_request", "The run input or workflow definition is invalid."
	default:
		return "run_failed", "The run could not start. Try again or inspect its details in Studio."
	}
}

func (s *SpacesService) ChatAgents() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		items, err := s.database.SpaceChatAgents(r.Context(), userID, chi.URLParam(r, "spaceID"))
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"agents": items})
	}
}

func uniqueStrings(values []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, value := range values {
		if !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	return out
}

func renderMessageText(content []db.MessageSpan) string {
	var b strings.Builder
	for _, span := range content {
		if span.Type == "text" {
			b.WriteString(span.Text)
		} else if span.Label != "" {
			b.WriteString("@")
			b.WriteString(span.Label)
		}
	}
	return strings.TrimSpace(b.String())
}

func (s *SpacesService) runMentionedAgent(ctx context.Context, billingUserID, spaceID, conversationID, agentID, sourceMessageID string, content []db.MessageSpan, fileNodeIDs []string) (*db.SpaceMessage, error) {
	attachments, err := s.prepareSpaceAgentFiles(ctx, billingUserID, spaceID, fileNodeIDs)
	if err != nil {
		return nil, err // File preparation happens before the metered model call.
	}
	prompt := renderMessageText(content) + attachments
	runInput, err := json.Marshal(map[string]any{
		"content":       content,
		"file_node_ids": fileNodeIDs,
		"prompt":        prompt,
	})
	if err != nil {
		return nil, err
	}
	decision, err := s.database.RouteAgentRequest(ctx, billingUserID, renderMessageText(content), spaceID, agentID, "")
	if err != nil {
		return nil, err
	}
	if decision.NeedsClarification || decision.Selected == nil {
		return s.createConversationAgentMessage(ctx, billingUserID, spaceID, conversationID, agentID, decision.Question)
	}
	sourceConversationID := sourceMessageID
	if conversationID != "" {
		sourceConversationID = conversationID
	}
	run, err := s.database.CreateAgentRun(ctx, db.AgentRunRequest{RequestingMemberID: billingUserID, SpaceID: spaceID, AgentID: agentID, SourceConversationID: sourceConversationID, SourceType: "group_mention", CapabilityID: decision.Selected.CapabilityID, Input: runInput, TriggerKind: "mention"})
	if err != nil {
		return nil, err
	}
	if run.State == "awaiting_approval" {
		return s.createConversationAgentMessage(ctx, billingUserID, spaceID, conversationID, agentID, "I prepared this isolated run, but it needs your approval before I can perform the proposed actions. Open the Agent in Studio to review run "+run.ID+".")
	}
	finished, err := s.executeCanonicalAgentRun((&http.Request{}).WithContext(ctx), run, prompt)
	if err != nil {
		return nil, err
	}
	text := "The isolated device run is queued. Track run " + finished.ID + " in Studio."
	var output map[string]any
	_ = json.Unmarshal(finished.Outputs, &output)
	if value, ok := output["text"].(string); ok && strings.TrimSpace(value) != "" {
		text = value
	}
	runes := []rune(strings.TrimSpace(text))
	if len(runes) > db.MaxMessageChars {
		runes = runes[:db.MaxMessageChars]
	}
	reply, err := s.createConversationAgentMessage(ctx, billingUserID, spaceID, conversationID, agentID, string(runes))
	if err != nil {
		return nil, err
	}
	_ = s.database.RecordRunAction(ctx, run.ID, "shared_reply", "Posted Agent reply in shared Space chat", mustAPIRawJSON(map[string]string{"message_id": reply.ID}), false, "completed")
	return reply, nil
}

func (s *SpacesService) createConversationAgentMessage(ctx context.Context, billingUserID, spaceID, conversationID, agentID, text string) (*db.SpaceMessage, error) {
	if conversationID == "" {
		return s.database.CreateSpaceAgentMessage(ctx, billingUserID, spaceID, agentID, text)
	}
	return s.database.CreateSpaceConversationAgentMessage(ctx, billingUserID, spaceID, conversationID, agentID, text)
}

func (s *SpacesService) prepareSpaceAgentFiles(ctx context.Context, userID, spaceID string, nodeIDs []string) (string, error) {
	if len(nodeIDs) == 0 {
		return "", nil
	}
	if len(nodeIDs) > db.MaxMessageFiles {
		return "", db.ErrSpaceInvalid
	}
	var builder strings.Builder
	for _, nodeID := range uniqueStrings(nodeIDs) {
		node, err := s.database.SpaceNodeSecret(ctx, userID, spaceID, nodeID)
		if err != nil {
			return "", err
		}
		target, err := s.decryptTarget(node.TargetCipher, node.TargetNonce)
		if err != nil {
			return "", err
		}
		text, err := fetchTemporaryGoogleText(ctx, target)
		if err != nil {
			return "", fmt.Errorf("could not prepare %s: %w", node.DisplayName, err)
		}
		builder.WriteString("\n\n[Attached Space file: ")
		builder.WriteString(node.DisplayName)
		builder.WriteString("]\n")
		builder.WriteString(text)
	}
	return builder.String(), nil
}

func fetchTemporaryGoogleText(ctx context.Context, target string) (string, error) {
	download, err := googleTextDownloadURL(target)
	if err != nil {
		return "", err
	}
	client := &http.Client{
		Timeout: 45 * time.Second,
		CheckRedirect: func(next *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("too many Google Drive redirects")
			}
			if _, err := validGoogleDriveTarget(next.URL.String()); err != nil {
				return errors.New("Google Drive redirected to an untrusted host")
			}
			next.Header.Del("Authorization")
			next.Header.Del("Cookie")
			return nil
		},
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, download, nil)
	if err != nil {
		return "", err
	}
	response, err := client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", errors.New("Google Drive file is unavailable or no longer shared")
	}
	contentType := strings.ToLower(response.Header.Get("Content-Type"))
	if strings.Contains(contentType, "text/html") || strings.Contains(contentType, "application/pdf") || strings.HasPrefix(contentType, "image/") || strings.HasPrefix(contentType, "video/") || strings.HasPrefix(contentType, "audio/") {
		return "", errors.New("this file needs document extraction that is not available for this run")
	}
	const maxBytes = 50 << 20
	raw, err := io.ReadAll(io.LimitReader(response.Body, maxBytes+1))
	if err != nil {
		return "", err
	}
	if len(raw) > maxBytes {
		return "", errors.New("file exceeds the 50 MiB Agent limit")
	}
	return string(raw), nil // The byte slice is never persisted and becomes unreachable after this run.
}

func googleTextDownloadURL(target string) (string, error) {
	parsed, err := validGoogleDriveTarget(target)
	if err != nil {
		return "", err
	}
	parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	if parsed.Hostname() == "docs.google.com" && len(parts) >= 3 {
		id := parts[2]
		switch parts[0] {
		case "document":
			return "https://docs.google.com/document/d/" + url.PathEscape(id) + "/export?format=txt", nil
		case "spreadsheets":
			return "https://docs.google.com/spreadsheets/d/" + url.PathEscape(id) + "/export?format=csv", nil
		}
	}
	for index, part := range parts {
		if part == "d" && index+1 < len(parts) && parts[index+1] != "" {
			return "https://drive.usercontent.google.com/download?export=download&id=" + url.QueryEscape(parts[index+1]), nil
		}
	}
	if id := parsed.Query().Get("id"); id != "" {
		return "https://drive.usercontent.google.com/download?export=download&id=" + url.QueryEscape(id), nil
	}
	return "", db.ErrSpaceInvalid
}

func (s *SpacesService) Message() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID, messageID := chi.URLParam(r, "spaceID"), chi.URLParam(r, "messageID")
		if r.Method == http.MethodDelete {
			if err := s.database.DeleteSpaceMessage(r.Context(), userID, spaceID, messageID); err != nil {
				writeSpaceError(w, err)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		var body struct {
			Content     []db.MessageSpan `json:"content"`
			FileNodeIDs []string         `json:"file_node_ids"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		message, err := s.database.UpdateSpaceMessage(r.Context(), userID, spaceID, messageID, body.Content, body.FileNodeIDs)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, message)
	}
}

func (s *SpacesService) MarkRead() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		var body struct {
			Seq int64 `json:"seq"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		if err := s.database.MarkSpaceRead(r.Context(), userID, chi.URLParam(r, "spaceID"), body.Seq); err != nil {
			writeSpaceError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (s *SpacesService) Nodes() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID := chi.URLParam(r, "spaceID")
		if r.Method == http.MethodGet {
			nodes, err := s.database.SpaceNodes(r.Context(), userID, spaceID)
			if err != nil {
				writeSpaceError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"nodes": nodes})
			return
		}
		var body struct {
			ID          string          `json:"id"`
			ParentID    string          `json:"parent_id"`
			Kind        string          `json:"kind"`
			DisplayName string          `json:"display_name"`
			DriveURL    string          `json:"drive_url"`
			MIMEType    string          `json:"mime_type"`
			SizeBytes   *int64          `json:"size_bytes"`
			Metadata    json.RawMessage `json:"metadata"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		node := db.SpaceNode{SpaceID: spaceID, ParentID: body.ParentID, Kind: body.Kind, DisplayName: body.DisplayName, MIMEType: body.MIMEType, SizeBytes: body.SizeBytes, Metadata: body.Metadata}
		if body.Kind == "link" {
			parsed, err := validGoogleDriveTarget(body.DriveURL)
			if err != nil {
				writeSpaceError(w, err)
				return
			}
			node.TargetCipher, node.TargetNonce, err = s.encryptTarget(parsed.String())
			if err != nil {
				writeSpaceError(w, err)
				return
			}
			node.KeyVersion = s.keyVer
		}
		saved, err := s.database.UpsertSpaceNode(r.Context(), userID, node)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, saved)
	}
}

func (s *SpacesService) Node() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID, nodeID := chi.URLParam(r, "spaceID"), chi.URLParam(r, "nodeID")
		if r.Method == http.MethodDelete {
			if err := s.database.DeleteSpaceNode(r.Context(), userID, spaceID, nodeID); err != nil {
				writeSpaceError(w, err)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		var body struct {
			ParentID    string          `json:"parent_id"`
			DisplayName string          `json:"display_name"`
			Stale       bool            `json:"stale"`
			MIMEType    string          `json:"mime_type"`
			SizeBytes   *int64          `json:"size_bytes"`
			Metadata    json.RawMessage `json:"metadata"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		current, err := s.database.SpaceNodeSecret(r.Context(), userID, spaceID, nodeID)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		current.ParentID, current.DisplayName, current.MIMEType, current.SizeBytes, current.Metadata = body.ParentID, body.DisplayName, body.MIMEType, body.SizeBytes, body.Metadata
		saved, err := s.database.UpsertSpaceNode(r.Context(), userID, *current)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		if body.Stale && !saved.Stale {
			_ = s.database.MarkSpaceNodeStale(r.Context(), userID, spaceID, nodeID)
			saved.Stale = true
		}
		writeJSON(w, http.StatusOK, saved)
	}
}

func randomToken() (string, string, error) {
	raw := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, raw); err != nil {
		return "", "", err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	return token, security.HashToken(token), nil
}

func (s *SpacesService) ResolveTicket() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		var body struct {
			Disposition string `json:"disposition"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		if body.Disposition == "" {
			body.Disposition = "open"
		}
		token, hash, err := randomToken()
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		if err := s.database.CreateResolveTicket(r.Context(), userID, chi.URLParam(r, "spaceID"), chi.URLParam(r, "nodeID"), body.Disposition, hash, time.Now().UTC().Add(60*time.Second)); err != nil {
			writeSpaceError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"ticket": token, "url": "/spaces/resolve/" + url.PathEscape(token), "expires_in": 60})
	}
}

func (s *SpacesService) Resolve() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := chi.URLParam(r, "ticket")
		userID, spaceID, nodeID, err := s.database.ConsumeResolveTicket(r.Context(), security.HashToken(token))
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		node, err := s.database.SpaceNodeSecret(r.Context(), userID, spaceID, nodeID)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		target, err := s.decryptTarget(node.TargetCipher, node.TargetNonce)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		parsed, err := validGoogleDriveTarget(target)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		http.Redirect(w, r, parsed.String(), http.StatusFound)
	}
}

func (s *SpacesService) Inbox() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		tab := r.URL.Query().Get("tab")
		if tab != "mentions" {
			tab = "unreads"
		}
		items, err := s.database.SpaceInbox(r.Context(), userID, tab, 100)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": items})
	}
}

func (s *SpacesService) InboxSeen() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		if err := s.database.MarkSpaceInboxSeen(r.Context(), userID); err != nil {
			writeSpaceError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (s *SpacesService) InboxClear() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		var body struct {
			Tab string `json:"tab"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		if body.Tab != "mentions" {
			body.Tab = "unreads"
		}
		if err := s.database.ClearSpaceInbox(r.Context(), userID, body.Tab); err != nil {
			writeSpaceError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (s *SpacesService) StudioResources(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID := chi.URLParam(r, "spaceID")
		if r.Method == http.MethodGet {
			items, err := s.database.SpaceStudioResources(r.Context(), userID, spaceID, kind)
			if err != nil {
				writeSpaceError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"resources": items})
			return
		}
		var item db.SpaceStudioResource
		if decodeJSON(w, r, &item) != nil {
			return
		}
		item.SpaceID, item.Kind = spaceID, kind
		saved, err := s.database.SaveSpaceStudioResource(r.Context(), userID, item)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, saved)
	}
}

func (s *SpacesService) DeleteStudioResource(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		if err := s.database.DeleteSpaceStudioResource(r.Context(), userID, chi.URLParam(r, "spaceID"), kind, chi.URLParam(r, "resourceID")); err != nil {
			writeSpaceError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func (s *SpacesService) RunStudioResource(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID, resourceID := chi.URLParam(r, "spaceID"), chi.URLParam(r, "resourceID")
		var body struct {
			Prompt       string          `json:"prompt"`
			CapabilityID string          `json:"capability_id"`
			Input        json.RawMessage `json:"input"`
		}
		if r.ContentLength > 0 && decodeJSON(w, r, &body) != nil {
			return
		}
		input := body.Input
		if len(input) == 0 {
			input, _ = json.Marshal(map[string]string{"prompt": strings.TrimSpace(body.Prompt)})
		}
		run, err := s.database.CreateSpaceRun(r.Context(), userID, spaceID, kind, resourceID, "test", body.CapabilityID, input)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		if run.State == "awaiting_approval" {
			writeJSON(w, http.StatusAccepted, run)
			return
		}
		finished, err := s.executeCanonicalAgentRun(r, run, body.Prompt)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, finished)
	}
}

func isPublicWorkflowIP(ip net.IP) bool {
	if ip == nil || !ip.IsGlobalUnicast() || ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() {
		return false
	}
	for _, cidr := range []string{"100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "2001:db8::/32"} {
		_, network, _ := net.ParseCIDR(cidr)
		if network.Contains(ip) {
			return false
		}
	}
	return true
}

// SpaceTargetFingerprint is used in audit logs and tests when a stable, safe
// identifier is needed. It never returns the Drive target itself.
func SpaceTargetFingerprint(target string) string {
	sum := sha256.Sum256([]byte(target))
	return hex.EncodeToString(sum[:8])
}
