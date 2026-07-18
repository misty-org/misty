package agent

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"
)

// ErrPersistedSessionNotFound allows persistence implementations to hide
// whether a conversation exists or belongs to another user.
var ErrPersistedSessionNotFound = errors.New("persisted ai session not found")

const conversationRetention = 30 * 24 * time.Hour

// PersistedConversationEvent is an append-only, sanitized audit record. The
// current session state is stored separately so a server can resume tool loops
// after a restart without replaying side effects.
type PersistedConversationEvent struct {
	Type string
	Data json.RawMessage
}

// SessionPersistence is deliberately small so the agent runtime remains
// usable without a database in tests and local development.
type SessionPersistence interface {
	CreateAgentSession(ctx context.Context, conversationID, userID string, state json.RawMessage, activeUntil, retentionExpiresAt time.Time) error
	LoadAgentSession(ctx context.Context, conversationID, userID string) (json.RawMessage, error)
	SaveAgentSession(ctx context.Context, conversationID, userID string, state json.RawMessage, events []PersistedConversationEvent, activeUntil, retentionExpiresAt time.Time) error
}

type persistedSessionState struct {
	ID                    string            `json:"id"`
	UserID                string            `json:"userId"`
	BillingUserID         string            `json:"billingUserId"`
	BillingScope          string            `json:"billingScope"`
	MikaTier              MikaTier          `json:"mikaTier"`
	Mode                  string            `json:"mode"`
	Capabilities          ToolManifest      `json:"capabilities"`
	Messages              []Message         `json:"messages"`
	ToolResults           []ToolResult      `json:"toolResults"`
	Events                []AgentEvent      `json:"events"`
	NextSequence          int64             `json:"nextSequence"`
	CreatedAt             time.Time         `json:"createdAt"`
	UpdatedAt             time.Time         `json:"updatedAt"`
	Canceled              bool              `json:"canceled"`
	ProviderCallsThisTurn int               `json:"providerCallsThisTurn"`
	PendingToolRequests   map[string]string `json:"pendingToolRequests"`
}

var (
	unixLocalPathPattern    = regexp.MustCompile(`(?:file://)?(?:/[^\s"'<>]+){2,}`)
	windowsLocalPathPattern = regexp.MustCompile(`(?i)[a-z]:\\(?:[^\s"'<>]+\\)+[^\s"'<>]*`)
)

func marshalPersistentSession(session *Session) (json.RawMessage, error) {
	state := persistedSessionState{
		ID:                    session.ID,
		UserID:                session.UserID,
		BillingUserID:         session.BillingUserID,
		BillingScope:          session.BillingScope,
		MikaTier:              session.MikaTier,
		Mode:                  session.Mode,
		Capabilities:          session.Capabilities,
		Messages:              sanitizeMessages(session.Messages),
		ToolResults:           sanitizeToolResults(session.ToolResults),
		Events:                sanitizeAgentEvents(session.Events),
		NextSequence:          session.nextSequence,
		CreatedAt:             session.CreatedAt,
		UpdatedAt:             session.UpdatedAt,
		Canceled:              session.Canceled,
		ProviderCallsThisTurn: session.ProviderCallsThisTurn,
		PendingToolRequests:   cloneStringMap(session.PendingToolRequests),
	}
	return json.Marshal(state)
}

func unmarshalPersistentSession(raw json.RawMessage, expectedID, expectedUserID string) (*Session, error) {
	var state persistedSessionState
	if err := json.Unmarshal(raw, &state); err != nil {
		return nil, err
	}
	if state.ID != expectedID || state.UserID != expectedUserID {
		return nil, ErrPersistedSessionNotFound
	}
	if state.Mode == "" {
		state.Mode = ModeAsk
	}
	if state.MikaTier == "" {
		state.MikaTier = MikaLow
	}
	if state.BillingUserID == "" {
		state.BillingUserID = state.UserID
	}
	return &Session{
		ID:                    state.ID,
		UserID:                state.UserID,
		BillingUserID:         state.BillingUserID,
		BillingScope:          state.BillingScope,
		MikaTier:              state.MikaTier,
		Mode:                  state.Mode,
		Capabilities:          state.Capabilities,
		Messages:              state.Messages,
		ToolResults:           state.ToolResults,
		KnownPaths:            make(map[string]struct{}),
		Events:                state.Events,
		nextSequence:          state.NextSequence,
		CreatedAt:             state.CreatedAt,
		UpdatedAt:             state.UpdatedAt,
		Canceled:              state.Canceled,
		ProviderCallsThisTurn: state.ProviderCallsThisTurn,
		PendingToolRequests:   cloneStringMap(state.PendingToolRequests),
	}, nil
}

func persistentEvents(beforeMessages, beforeResults, beforeEvents int, session *Session) []PersistedConversationEvent {
	events := make([]PersistedConversationEvent, 0)
	for _, message := range session.Messages[boundedIndex(beforeMessages, len(session.Messages)):] {
		eventType := "user_message"
		if message.Role == "assistant" {
			eventType = "assistant_message"
		}
		data, _ := json.Marshal(map[string]any{"message": sanitizeMessage(message)})
		events = append(events, PersistedConversationEvent{Type: eventType, Data: data})
	}
	for _, result := range session.ToolResults[boundedIndex(beforeResults, len(session.ToolResults)):] {
		data, _ := json.Marshal(map[string]any{"toolResult": sanitizeToolResult(result)})
		events = append(events, PersistedConversationEvent{Type: "tool_result", Data: data})
	}
	for _, event := range session.Events[boundedIndex(beforeEvents, len(session.Events)):] {
		if event.Type == EventAssistantMessage {
			continue // already represented by the assistant message above
		}
		eventType := "tool_call"
		if event.Type == EventError {
			eventType = "error"
		}
		data, _ := json.Marshal(map[string]any{"event": sanitizeAgentEvent(event)})
		events = append(events, PersistedConversationEvent{Type: eventType, Data: data})
	}
	return events
}

func boundedIndex(index, length int) int {
	if index < 0 || index > length {
		return length
	}
	return index
}

func sanitizeMessages(messages []Message) []Message {
	out := make([]Message, len(messages))
	for i, message := range messages {
		out[i] = sanitizeMessage(message)
	}
	return out
}

func sanitizeMessage(message Message) Message {
	message.Content = redactLocalPaths(message.Content)
	return message
}

func sanitizeToolResults(results []ToolResult) []ToolResult {
	out := make([]ToolResult, len(results))
	for i, result := range results {
		out[i] = sanitizeToolResult(result)
	}
	return out
}

func sanitizeToolResult(result ToolResult) ToolResult {
	if result.Name == ToolPreviewFile {
		result.Result = sanitizePreviewFileResult(result.Result)
	} else {
		result.Result = sanitizeRawJSON(result.Result)
	}
	result.Error = redactLocalPaths(result.Error)
	return result
}

// Extracted native document text follows the short-lived file-content
// policy, not the 30-day conversation policy. Persist only citation
// coordinates and harmless document metadata needed to explain an answer.
func sanitizePreviewFileResult(raw json.RawMessage) json.RawMessage {
	var document struct {
		DocumentID   string `json:"documentId"`
		FileName     string `json:"fileName"`
		MimeType     string `json:"mimeType"`
		ScopeID      string `json:"scopeId"`
		RelativePath string `json:"relativePath"`
		Sections     []struct {
			Kind    string `json:"kind"`
			Locator string `json:"locator"`
		} `json:"sections"`
		Truncated bool `json:"truncated"`
	}
	if json.Unmarshal(raw, &document) != nil {
		return nil
	}
	cleaned, err := json.Marshal(document)
	if err != nil {
		return nil
	}
	return sanitizeRawJSON(cleaned)
}

func sanitizeAgentEvents(events []AgentEvent) []AgentEvent {
	out := make([]AgentEvent, len(events))
	for i, event := range events {
		out[i] = sanitizeAgentEvent(event)
	}
	return out
}

func sanitizeAgentEvent(event AgentEvent) AgentEvent {
	event.Text = redactLocalPaths(event.Text)
	event.Message = redactLocalPaths(event.Message)
	if event.FilePlan != nil {
		plan := *event.FilePlan
		plan.Operations = append([]FileOperation(nil), plan.Operations...)
		for index := range plan.Operations {
			plan.Operations[index].Path = ""
			plan.Operations[index].From = ""
			plan.Operations[index].To = ""
		}
		event.FilePlan = &plan
	}
	event.ToolRequests = append([]ToolRequest(nil), event.ToolRequests...)
	for index := range event.ToolRequests {
		event.ToolRequests[index].Arguments = sanitizeRawJSON(event.ToolRequests[index].Arguments)
	}
	event.Citations = append([]AgentCitation(nil), event.Citations...)
	for index := range event.Citations {
		event.Citations[index].Excerpt = redactLocalPaths(event.Citations[index].Excerpt)
	}
	return event
}

func sanitizeRawJSON(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return raw
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil
	}
	value = sanitizeJSONValue(value)
	cleaned, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	return cleaned
}

func sanitizeJSONValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		out := make(map[string]any, len(typed))
		for key, child := range typed {
			normalized := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(key, "_", ""), "-", ""))
			switch normalized {
			case "imagedataurl", "imageurl", "dataurl", "activeroot", "absolutepath", "localpath", "path", "from", "to":
				continue
			}
			out[key] = sanitizeJSONValue(child)
		}
		return out
	case []any:
		out := make([]any, len(typed))
		for index, child := range typed {
			out[index] = sanitizeJSONValue(child)
		}
		return out
	case string:
		if strings.HasPrefix(strings.ToLower(strings.TrimSpace(typed)), "data:image/") {
			return "[image omitted]"
		}
		return redactLocalPaths(typed)
	default:
		return value
	}
}

func redactLocalPaths(value string) string {
	value = unixLocalPathPattern.ReplaceAllString(value, "[local path]")
	return windowsLocalPathPattern.ReplaceAllString(value, "[local path]")
}

func cloneStringMap(values map[string]string) map[string]string {
	out := make(map[string]string, len(values))
	for key, value := range values {
		out[key] = value
	}
	return out
}
