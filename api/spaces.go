package api

import (
	"bytes"
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
	"time"

	"github.com/go-chi/chi/v5"
	serveragent "github.com/kannachi323/misty/server/agent"
	"github.com/kannachi323/misty/server/db"
	"github.com/kannachi323/misty/server/security"
)

type SpacesService struct {
	database *db.Database
	agent    *serveragent.Service
	aead     cipher.AEAD
	keyVer   int16
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
	case errors.Is(err, db.ErrSpaceForbidden):
		writeJSON(w, http.StatusForbidden, map[string]string{"code": "forbidden"})
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
	case errors.Is(err, db.ErrSpaceInvalid):
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
		for _, agentID := range uniqueStrings(agentIDs) {
			reply, runErr := s.runMentionedAgent(r.Context(), userID, spaceID, agentID, body.Content, body.FileNodeIDs)
			if runErr == nil && reply != nil {
				agentReplies = append(agentReplies, reply)
			}
		}
		writeJSON(w, http.StatusCreated, map[string]any{"message": message, "agent_replies": agentReplies})
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

func (s *SpacesService) runMentionedAgent(ctx context.Context, billingUserID, spaceID, agentID string, content []db.MessageSpan, fileNodeIDs []string) (*db.SpaceMessage, error) {
	if s.agent == nil {
		return nil, errors.New("agent runtime unavailable")
	}
	name, instructions, err := s.database.SpaceAgentPrompt(ctx, billingUserID, spaceID, agentID)
	if err != nil {
		return nil, err
	}
	attachments, err := s.prepareSpaceAgentFiles(ctx, billingUserID, spaceID, fileNodeIDs)
	if err != nil {
		return nil, err // File preparation happens before the metered model call.
	}
	runInput, err := json.Marshal(map[string]any{
		"content":       content,
		"file_node_ids": fileNodeIDs,
	})
	if err != nil {
		return nil, err
	}
	run, err := s.database.CreateSpaceRun(ctx, billingUserID, spaceID, "agent", agentID, "mention", runInput)
	if err != nil {
		return nil, err
	}
	prompt := fmt.Sprintf("You are %s, a shared Space agent. Follow these instructions:\n%s\n\nRespond to this Space message:\n%s%s", name, instructions, renderMessageText(content), attachments)
	text, _, err := s.agent.CompleteWithTierContext(ctx, billingUserID, prompt, "automation_ai", serveragent.MikaLow)
	if err != nil {
		_, _ = s.database.FinishSpaceRun(ctx, run.ID, "failed", json.RawMessage(`{}`), "execution_failed")
		return nil, err
	}
	runes := []rune(strings.TrimSpace(text))
	if len(runes) > db.MaxMessageChars {
		runes = runes[:db.MaxMessageChars]
	}
	reply, err := s.database.CreateSpaceAgentMessage(ctx, billingUserID, spaceID, agentID, string(runes))
	if err != nil {
		_, _ = s.database.FinishSpaceRun(ctx, run.ID, "failed", json.RawMessage(`{}`), "reply_failed")
		return nil, err
	}
	result, err := json.Marshal(map[string]string{"message_id": reply.ID})
	if err != nil {
		_, _ = s.database.FinishSpaceRun(ctx, run.ID, "failed", json.RawMessage(`{}`), "result_failed")
		return nil, err
	}
	if _, err := s.database.FinishSpaceRun(ctx, run.ID, "completed", result, ""); err != nil {
		return nil, err
	}
	return reply, nil
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
			Prompt string          `json:"prompt"`
			Input  json.RawMessage `json:"input"`
		}
		if r.ContentLength > 0 && decodeJSON(w, r, &body) != nil {
			return
		}
		input := body.Input
		if len(input) == 0 {
			input, _ = json.Marshal(map[string]string{"prompt": strings.TrimSpace(body.Prompt)})
		}
		run, err := s.database.CreateSpaceRun(r.Context(), userID, spaceID, kind, resourceID, "manual", input)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		var result any
		if kind == "agent" {
			result, err = s.executeSpaceAgent(r.Context(), run, body.Prompt)
		} else {
			result, err = s.executeSpaceWorkflow(r.Context(), run)
		}
		if err != nil {
			failedResult, _ := json.Marshal(map[string]string{"message": err.Error()})
			finished, finishErr := s.database.FinishSpaceRun(r.Context(), run.ID, "failed", failedResult, "execution_failed")
			if finishErr != nil {
				writeSpaceError(w, finishErr)
				return
			}
			writeJSON(w, http.StatusOK, finished)
			return
		}
		raw, _ := json.Marshal(result)
		finished, err := s.database.FinishSpaceRun(r.Context(), run.ID, "completed", raw, "")
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, finished)
	}
}

func (s *SpacesService) executeSpaceAgent(ctx context.Context, run *db.SpaceRun, prompt string) (map[string]string, error) {
	if s.agent == nil {
		return nil, errors.New("Space Agent runtime is unavailable")
	}
	resource, err := s.database.SpaceStudioResourceByID(ctx, run.InitiatedByUserID, run.SpaceID, "agent", run.ResourceID)
	if err != nil {
		return nil, err
	}
	prompt = strings.TrimSpace(prompt)
	if prompt == "" {
		return nil, db.ErrSpaceInvalid
	}
	request := fmt.Sprintf("You are %s, a shared Space agent. Follow these instructions:\n%s\n\n%s", resource.Name, resource.Instructions, prompt)
	text, _, err := s.agent.CompleteWithTierContext(ctx, run.BillingUserID, request, "automation_ai", serveragent.MikaLow)
	if err != nil {
		return nil, err
	}
	return map[string]string{"text": strings.TrimSpace(text)}, nil
}

func (s *SpacesService) executeSpaceWorkflow(ctx context.Context, run *db.SpaceRun) (map[string]any, error) {
	resource, err := s.database.SpaceStudioResourceByID(ctx, run.InitiatedByUserID, run.SpaceID, "workflow", run.ResourceID)
	if err != nil {
		return nil, err
	}
	var workflow struct {
		Nodes []struct {
			Kind   string         `json:"kind"`
			Type   string         `json:"type"`
			Config map[string]any `json:"config"`
		} `json:"nodes"`
	}
	if err := json.Unmarshal(resource.Definition, &workflow); err != nil {
		return nil, db.ErrSpaceInvalid
	}
	value := strings.TrimSpace(string(run.Input))
	steps := make([]map[string]any, 0, len(workflow.Nodes))
	for _, node := range workflow.Nodes {
		kind := node.Kind
		if kind == "" {
			kind = node.Type
		}
		switch kind {
		case "manual_trigger", "schedule_trigger", "webhook_trigger", "message_trigger", "file_link_trigger":
			// The trigger has already supplied run.Input.
		case "text":
			value = stringConfig(node.Config, "text")
		case "filter":
			contains := stringConfig(node.Config, "contains")
			if contains != "" && !strings.Contains(strings.ToLower(value), strings.ToLower(contains)) {
				value = ""
			}
		case "transform":
			if prefix := stringConfig(node.Config, "prefix"); prefix != "" {
				value = prefix + value
			}
			if suffix := stringConfig(node.Config, "suffix"); suffix != "" {
				value += suffix
			}
		case "structured_prompt":
			if s.agent == nil {
				return nil, errors.New("managed AI is unavailable")
			}
			prompt := strings.ReplaceAll(stringConfig(node.Config, "prompt"), "{{input}}", value)
			text, _, completeErr := s.agent.CompleteWithTierContext(ctx, run.BillingUserID, prompt, "automation_ai", serveragent.MikaLow)
			if completeErr != nil {
				return nil, completeErr
			}
			value = text
		case "notify", "chat_reply":
			message := strings.ReplaceAll(stringConfig(node.Config, "message"), "{{input}}", value)
			if message == "" {
				message = value
			}
			steps = append(steps, map[string]any{"kind": kind, "message": message})
		case "http_request":
			response, requestErr := executeSafeHTTPRequest(ctx, node.Config, value)
			if requestErr != nil {
				return nil, requestErr
			}
			value = response
		case "virtual_folder", "virtual_link":
			steps = append(steps, map[string]any{"kind": kind, "status": "planned"})
		case "":
			return nil, db.ErrSpaceInvalid
		default:
			return nil, fmt.Errorf("unsupported cloud node %q", kind)
		}
		steps = append(steps, map[string]any{"kind": kind, "ok": true})
	}
	return map[string]any{"value": value, "steps": steps}, nil
}

func stringConfig(config map[string]any, key string) string {
	value, _ := config[key].(string)
	return value
}

func executeSafeHTTPRequest(ctx context.Context, config map[string]any, input string) (string, error) {
	rawURL := strings.ReplaceAll(stringConfig(config, "url"), "{{input}}", url.QueryEscape(input))
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil {
		return "", errors.New("HTTP workflow nodes require a public HTTPS URL")
	}
	method := strings.ToUpper(strings.TrimSpace(stringConfig(config, "method")))
	if method == "" {
		method = http.MethodGet
	}
	allowedMethods := map[string]bool{http.MethodGet: true, http.MethodPost: true, http.MethodPut: true, http.MethodPatch: true, http.MethodDelete: true}
	if !allowedMethods[method] {
		return "", errors.New("HTTP workflow method is not allowed")
	}
	body := strings.ReplaceAll(stringConfig(config, "body"), "{{input}}", input)
	request, err := http.NewRequestWithContext(ctx, method, parsed.String(), bytes.NewBufferString(body))
	if err != nil {
		return "", err
	}
	request.Header.Set("Accept", "application/json, text/plain;q=0.9")
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	transport := &http.Transport{
		Proxy: nil,
		DialContext: func(dialCtx context.Context, network, address string) (net.Conn, error) {
			host, port, splitErr := net.SplitHostPort(address)
			if splitErr != nil {
				return nil, splitErr
			}
			ips, resolveErr := net.DefaultResolver.LookupIPAddr(dialCtx, host)
			if resolveErr != nil {
				return nil, resolveErr
			}
			for _, candidate := range ips {
				if isPublicWorkflowIP(candidate.IP) {
					return (&net.Dialer{Timeout: 8 * time.Second}).DialContext(dialCtx, network, net.JoinHostPort(candidate.IP.String(), port))
				}
			}
			return nil, errors.New("HTTP workflow target resolves to a private or reserved address")
		},
		TLSHandshakeTimeout: 8 * time.Second,
	}
	client := &http.Client{
		Transport: transport,
		Timeout:   15 * time.Second,
		CheckRedirect: func(next *http.Request, via []*http.Request) error {
			if len(via) >= 3 || next.URL.Scheme != "https" || next.URL.User != nil {
				return errors.New("HTTP workflow redirect was rejected")
			}
			next.Header.Del("Authorization")
			next.Header.Del("Cookie")
			return nil
		},
	}
	response, err := client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	limited, err := io.ReadAll(io.LimitReader(response.Body, 1<<20+1))
	if err != nil {
		return "", err
	}
	if len(limited) > 1<<20 {
		return "", errors.New("HTTP workflow response exceeded 1 MiB")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", fmt.Errorf("HTTP workflow returned %s", response.Status)
	}
	return string(limited), nil
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
