package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	db "github.com/kannachi323/misty/server/internal/platform/postgres"

	"github.com/go-chi/chi/v5"
	serveragent "github.com/kannachi323/misty/server/internal/agents"
)

func (s *SpacesService) runMentionedAgent(ctx context.Context, billingUserID, spaceID, conversationID, agentID, sourceMessageID string, content []db.MessageSpan, fileNodeIDs []string) (*db.SpaceMessage, error) {
	personal, personalErr := s.database.PersonalAgentForSpace(ctx, billingUserID, spaceID, agentID)
	if personalErr != nil && !errors.Is(personalErr, db.ErrPersonalAgentNotFound) {
		return nil, personalErr
	}
	attachments, err := s.prepareSpaceAgentFiles(ctx, billingUserID, spaceID, fileNodeIDs)
	if err != nil {
		return nil, err // File preparation happens before the metered model call.
	}
	prompt := renderMessageText(content) + attachments
	if personal != nil {
		spaceContext, contextErr := s.database.PersonalAgentSpaceContextForConversation(ctx, billingUserID, spaceID, conversationID, personal.ContextPermissions)
		if contextErr != nil {
			return nil, contextErr
		}
		memoryContext, memoryErr := s.database.PersonalAgentMemoryContext(ctx, billingUserID, spaceID, personal.ID)
		if memoryErr != nil {
			return nil, memoryErr
		}
		groundedPrompt := "You are " + personal.Name + ". Follow these owner-provided instructions:\n" + personal.Instructions + "\n\nUse only this permission-filtered Space context when relevant:\n" + spaceContext
		if memoryContext != "" {
			groundedPrompt += "\n\nPrivate memory for this user, agent, and Space. Do not expose it to other members:\n" + memoryContext
		}
		groundedPrompt += "\n\nCurrent request:\n" + prompt
		var text string
		if personal.ModelMode == "pinned" {
			text, _, err = s.agent.CompleteWithModelContext(ctx, billingUserID, groundedPrompt, "agent_chat_ai", personal.ModelID)
		} else {
			text, _, err = s.agent.CompleteWithTierContext(ctx, billingUserID, groundedPrompt, "agent_chat_ai", serveragent.TierLow)
		}
		if err != nil {
			return nil, err
		}
		runes := []rune(strings.TrimSpace(text))
		if len(runes) > db.MaxMessageChars {
			runes = runes[:db.MaxMessageChars]
		}
		reply, createErr := s.createConversationAgentMessage(ctx, billingUserID, spaceID, conversationID, agentID, string(runes))
		if createErr == nil {
			_ = s.database.AppendPersonalAgentMemory(ctx, billingUserID, spaceID, agentID, renderMessageText(content), string(runes))
		}
		return reply, createErr
	}
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
	_ = s.database.RecordRunAction(ctx, run.ID, "shared_reply", "Posted Agent reply in shared Space chat", TestingMustAPIRawJSON(map[string]string{"message_id": reply.ID}), false, "completed")
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
		target, err := s.TestingDecryptTarget(node.TargetCipher, node.TargetNonce)
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
			if _, err := TestingValidGoogleDriveTarget(next.URL.String()); err != nil {
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
	parsed, err := TestingValidGoogleDriveTarget(target)
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
