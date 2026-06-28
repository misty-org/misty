package ai

import (
	"encoding/json"
	"strings"
)

type Service struct {
	store    *SessionStore
	provider ModelProvider
	policy   PermissionPolicy
}

func NewService(store *SessionStore, provider ModelProvider) *Service {
	if store == nil {
		store = NewSessionStore(0)
	}
	if provider == nil {
		provider = MockProvider{}
	}
	return &Service{
		store:    store,
		provider: provider,
		policy:   PermissionPolicy{},
	}
}

func (s *Service) Store() *SessionStore {
	return s.store
}

func (s *Service) CreateSession(userID string) *Session {
	return s.store.Create(userID)
}

func (s *Service) SendMessage(sessionID, userID string, request AgentMessageRequest) error {
	request.UserMessage = strings.TrimSpace(request.UserMessage)
	request.Mode = NormalizeMode(request.Mode)
	if request.UserMessage == "" {
		return ErrInvalidRequest("user_message is required")
	}
	return s.store.WithSession(sessionID, userID, func(session *Session) error {
		if session.Canceled {
			return ErrInvalidRequest("session is canceled")
		}
		session.Mode = request.Mode
		session.ActiveRoot = strings.TrimSpace(request.ActiveRoot)
		session.Capabilities = request.Capabilities
		for _, selected := range request.SelectedPaths {
			if normalized, ok := normalizeRelativePath(selected); ok {
				session.KnownPaths[normalized] = struct{}{}
			}
		}
		session.Messages = append(session.Messages, Message{Role: "user", Content: request.UserMessage})
		return s.advanceLocked(session)
	})
}

func (s *Service) SubmitToolResults(sessionID, userID string, results []ToolResult) error {
	if len(results) == 0 {
		return ErrInvalidRequest("tool results are required")
	}
	return s.store.WithSession(sessionID, userID, func(session *Session) error {
		if session.Canceled {
			return ErrInvalidRequest("session is canceled")
		}
		session.ToolResults = append(session.ToolResults, results...)
		collectKnownPaths(session, results)
		return s.advanceLocked(session)
	})
}

func (s *Service) Events(sessionID, userID string, after int64) ([]AgentEvent, error) {
	return s.store.Events(sessionID, userID, after)
}

func (s *Service) Cancel(sessionID, userID string) error {
	return s.store.Cancel(sessionID, userID)
}

func (s *Service) advanceLocked(session *Session) error {
	response, err := s.provider.Next(ModelRequest{
		SessionID:    session.ID,
		UserID:       session.UserID,
		Mode:         session.Mode,
		ActiveRoot:   session.ActiveRoot,
		Messages:     append([]Message(nil), session.Messages...),
		ToolResults:  append([]ToolResult(nil), session.ToolResults...),
		Capabilities: session.Capabilities,
		KnownPaths:   knownPaths(session),
	})
	if err != nil {
		session.appendEvent(AgentEvent{Type: EventError, Message: err.Error()})
		return nil
	}
	if strings.TrimSpace(response.Text) != "" {
		session.Messages = append(session.Messages, Message{Role: "assistant", Content: response.Text})
		session.appendEvent(AgentEvent{Type: EventAssistantMessage, Text: response.Text})
	}
	if len(response.ToolRequests) > 0 {
		requests := s.policy.Apply(session.Mode, response.ToolRequests)
		session.appendEvent(AgentEvent{Type: EventToolRequest, ToolRequests: requests})
	}
	if response.FilePlan != nil {
		problems := ValidateFilePlan(*response.FilePlan, PlanValidationContext{KnownPaths: knownPaths(session)})
		if len(problems) > 0 {
			plan := *response.FilePlan
			plan.Warnings = append(plan.Warnings, problems...)
			session.appendEvent(AgentEvent{Type: EventFilePlan, FilePlan: &plan})
			return nil
		}
		session.appendEvent(AgentEvent{Type: EventFilePlan, FilePlan: response.FilePlan})
	}
	return nil
}

func knownPaths(session *Session) []string {
	paths := make([]string, 0, len(session.KnownPaths))
	for path := range session.KnownPaths {
		paths = append(paths, path)
	}
	return paths
}

func collectKnownPaths(session *Session, results []ToolResult) {
	for _, result := range results {
		if !result.OK || len(result.Result) == 0 {
			continue
		}
		var payload any
		if err := json.Unmarshal(result.Result, &payload); err != nil {
			continue
		}
		collectKnownPathsFromValue(session, payload)
	}
}

func collectKnownPathsFromValue(session *Session, value any) {
	switch typed := value.(type) {
	case map[string]any:
		for _, key := range []string{"relativePath", "relative_path", "path", "name"} {
			if raw, ok := typed[key].(string); ok {
				if normalized, ok := normalizeRelativePath(raw); ok {
					session.KnownPaths[normalized] = struct{}{}
				}
			}
		}
		for _, child := range typed {
			collectKnownPathsFromValue(session, child)
		}
	case []any:
		for _, child := range typed {
			collectKnownPathsFromValue(session, child)
		}
	}
}

type ErrInvalidRequest string

func (e ErrInvalidRequest) Error() string {
	return string(e)
}
