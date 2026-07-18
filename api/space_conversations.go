package api

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/kannachi323/misty/server/db"
)

func (s *SpacesService) Conversations() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID := chi.URLParam(r, "spaceID")
		if r.Method == http.MethodGet {
			items, err := s.database.SpaceConversations(r.Context(), userID, spaceID)
			if err != nil {
				writeSpaceError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"conversations": items})
			return
		}
		var body struct {
			Title     string   `json:"title"`
			MemberIDs []string `json:"member_ids"`
		}
		if decodeJSON(w, r, &body) != nil {
			return
		}
		item, err := s.database.CreateSpaceConversation(r.Context(), userID, spaceID, body.Title, body.MemberIDs)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, item)
	}
}

func (s *SpacesService) ConversationMessages() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID := chi.URLParam(r, "spaceID")
		conversationID := chi.URLParam(r, "conversationID")
		if r.Method == http.MethodGet {
			before, _ := strconv.ParseInt(r.URL.Query().Get("before"), 10, 64)
			limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
			messages, err := s.database.SpaceConversationMessages(r.Context(), userID, spaceID, conversationID, before, limit)
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
		message, agentIDs, err := s.database.CreateSpaceConversationMessageWithReferences(r.Context(), userID, spaceID, conversationID, body.Content, body.FileNodeIDs, body.AttachmentIDs, body.LibraryItemIDs, body.ReplyToMessageID)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		agentReplies := make([]*db.SpaceMessage, 0, len(agentIDs))
		agentFailures := make([]agentMentionFailure, 0)
		for _, agentID := range uniqueStrings(agentIDs) {
			reply, runErr := s.runMentionedAgent(r.Context(), userID, spaceID, conversationID, agentID, message.ID, body.Content, body.FileNodeIDs)
			if runErr != nil {
				agentFailures = append(agentFailures, agentMentionFailureFromError(agentID, runErr))
			} else if reply != nil {
				agentReplies = append(agentReplies, reply)
			}
		}
		writeJSON(w, http.StatusCreated, map[string]any{"message": message, "agent_replies": agentReplies, "agent_failures": agentFailures})
	}
}

func (s *SpacesService) ConversationMessage() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		spaceID := chi.URLParam(r, "spaceID")
		conversationID := chi.URLParam(r, "conversationID")
		messageID := chi.URLParam(r, "messageID")
		if r.Method == http.MethodDelete {
			if err := s.database.DeleteSpaceConversationMessage(r.Context(), userID, spaceID, conversationID, messageID); err != nil {
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
		message, err := s.database.UpdateSpaceConversationMessage(r.Context(), userID, spaceID, conversationID, messageID, body.Content, body.FileNodeIDs)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, message)
	}
}
