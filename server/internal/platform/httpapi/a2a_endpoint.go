package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	envconfig "github.com/kannachi323/misty/server/internal/platform/config"
	db "github.com/kannachi323/misty/server/internal/platform/postgres"
)

// The A2A endpoint lets a member's own client or tool talk to an agent another
// member published to a shared Space. It speaks A2A's JSON-RPC methods and
// sends every message through the same request service as agents_request, so
// consent, approval, billing and limits are identical.
const a2aProtocolVersion = "0.3.0"

type a2aRPC struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

type a2aPart struct {
	Kind string `json:"kind"`
	Text string `json:"text,omitempty"`
}

type a2aMessage struct {
	Role      string    `json:"role"`
	Parts     []a2aPart `json:"parts"`
	MessageID string    `json:"messageId"`
	ContextID string    `json:"contextId,omitempty"`
	TaskID    string    `json:"taskId,omitempty"`
	Kind      string    `json:"kind"`
}

// A2AAgentCard describes one published agent to A2A clients.
func (s *SpacesService) A2AAgentCard() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		listing, err := s.a2aListing(r, userID)
		if err != nil {
			writeSpaceError(w, err)
			return
		}
		description := listing.Description
		if description == "" {
			description = listing.OwnerName + "’s agent in " + listing.SpaceName
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"protocolVersion": a2aProtocolVersion, "name": listing.AgentName, "description": description,
			"url": a2aEndpointURL(r), "preferredTransport": "JSONRPC", "version": "1",
			"capabilities":      map[string]any{"streaming": false, "pushNotifications": false},
			"defaultInputModes": []string{"text/plain"}, "defaultOutputModes": []string{"text/plain"},
			"skills": []map[string]any{{"id": "space-work", "name": "Work in " + listing.SpaceName,
				"description": description, "tags": []string{"misty", "space"}}},
			"provider": map[string]any{"organization": "Misty", "url": "https://misty.app"},
		})
	}
}

// A2AAgent handles message/send, tasks/get and tasks/cancel.
func (s *SpacesService) A2AAgent() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticatedUser(w, r, s.database)
		if !ok {
			return
		}
		var call a2aRPC
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&call); err != nil {
			writeA2AError(w, nil, -32700, "Parse error")
			return
		}
		if call.JSONRPC != "2.0" || call.Method == "" {
			writeA2AError(w, call.ID, -32600, "Invalid Request")
			return
		}
		listing, err := s.a2aListing(r, userID)
		if err != nil {
			writeA2AError(w, call.ID, -32001, "This agent is not published to a Space you share")
			return
		}
		var request *db.AgentMemberRequest
		switch call.Method {
		case "message/send":
			request, err = s.a2aSend(r, userID, listing, call.Params)
		case "tasks/get", "tasks/cancel":
			var params struct {
				ID string `json:"id"`
			}
			if json.Unmarshal(call.Params, &params) != nil || params.ID == "" {
				writeA2AError(w, call.ID, -32602, "Invalid params")
				return
			}
			if call.Method == "tasks/get" {
				request, err = s.database.AgentMemberRequestForUser(r.Context(), userID, params.ID)
			} else {
				request, err = s.database.CancelAgentMemberRequest(r.Context(), userID, params.ID)
			}
			if err == nil && request.TargetAgentID != listing.AgentID {
				err = db.ErrSpaceNotFound
			}
		default:
			writeA2AError(w, call.ID, -32601, "Method not found")
			return
		}
		switch {
		case errors.Is(err, db.ErrSpaceNotFound):
			writeA2AError(w, call.ID, -32001, "Task not found")
		case errors.Is(err, db.ErrSpaceConflict):
			writeA2AError(w, call.ID, -32002, "Task cannot be canceled")
		case err != nil:
			writeA2AError(w, call.ID, -32603, agentRequestError(err, *listing).Error())
		default:
			writeJSON(w, http.StatusOK, map[string]any{"jsonrpc": "2.0", "id": call.ID, "result": a2aTask(request)})
		}
	}
}

func (s *SpacesService) a2aListing(r *http.Request, userID string) (*db.SpaceAgentListing, error) {
	listings, err := s.database.SpaceAgentListings(r.Context(), userID, chi.URLParam(r, "spaceID"))
	if err != nil {
		return nil, err
	}
	for index := range listings {
		if listings[index].AgentID == chi.URLParam(r, "agentID") {
			return &listings[index], nil
		}
	}
	return nil, db.ErrSpaceNotFound
}

func (s *SpacesService) a2aSend(r *http.Request, userID string, listing *db.SpaceAgentListing, raw json.RawMessage) (*db.AgentMemberRequest, error) {
	var params struct {
		Message a2aMessage `json:"message"`
	}
	if json.Unmarshal(raw, &params) != nil || strings.TrimSpace(params.Message.MessageID) == "" {
		return nil, db.ErrSpaceInvalid
	}
	if params.Message.TaskID != "" {
		// A request is one task; follow-ups start a new one.
		return nil, db.ErrSpaceInvalid
	}
	var text strings.Builder
	for _, part := range params.Message.Parts {
		if part.Kind == "text" {
			text.WriteString(part.Text)
		}
	}
	return s.database.CreateAgentMemberRequest(r.Context(), db.AgentMemberRequestInput{
		SpaceID: listing.SpaceID, RequesterUserID: userID, RequesterRunID: db.ExternalAgentRequester(userID),
		TargetAgentID: listing.AgentID, Message: text.String(), IdempotencyKey: params.Message.MessageID,
	})
}

// a2aTask maps a request onto an A2A Task.
func a2aTask(request *db.AgentMemberRequest) map[string]any {
	state := memberRequestState(request)
	switch state {
	case "awaiting_approval":
		state = "auth-required"
	case "failed":
		if request.RunState == "rejected" {
			state = "rejected"
		}
	}
	var view struct {
		Reply string `json:"reply"`
		Error string `json:"error"`
		Note  string `json:"note"`
	}
	_ = json.Unmarshal(agentRequestView(request), &view)
	status := map[string]any{"state": state, "timestamp": time.Now().UTC().Format(time.RFC3339)}
	if note := strings.TrimSpace(view.Error + view.Note); note != "" {
		status["message"] = map[string]any{"kind": "message", "role": "agent", "messageId": request.ID + ":status",
			"parts": []a2aPart{{Kind: "text", Text: note}}}
	}
	task := map[string]any{"kind": "task", "id": request.ID, "contextId": request.ID, "status": status}
	if view.Reply != "" {
		task["artifacts"] = []map[string]any{{"artifactId": request.ID + ":reply", "name": "reply", "parts": []a2aPart{{Kind: "text", Text: view.Reply}}}}
	}
	return task
}

// a2aEndpointURL is the agent's absolute JSON-RPC address on the public API.
func a2aEndpointURL(r *http.Request) string {
	path := strings.TrimSuffix(r.URL.Path, "/.well-known/agent-card.json")
	public, err := url.Parse(strings.TrimSpace(envconfig.Getenv("MISTY_PUBLIC_API_URL")))
	if err != nil || public.Scheme == "" || public.Host == "" {
		return path
	}
	return public.Scheme + "://" + public.Host + path
}

func writeA2AError(w http.ResponseWriter, id json.RawMessage, code int, message string) {
	if len(id) == 0 {
		id = json.RawMessage(`null`)
	}
	writeJSON(w, http.StatusOK, map[string]any{"jsonrpc": "2.0", "id": id, "error": map[string]any{"code": code, "message": message}})
}
