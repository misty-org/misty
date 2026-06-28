package ai

import (
	"errors"
	"sync"
	"time"

	"github.com/google/uuid"
)

var ErrSessionNotFound = errors.New("ai session not found")

type SessionStore struct {
	mu       sync.Mutex
	now      func() time.Time
	ttl      time.Duration
	sessions map[string]*Session
}

type Session struct {
	ID           string
	UserID       string
	Mode         string
	ActiveRoot   string
	Capabilities ToolManifest
	Messages     []Message
	ToolResults  []ToolResult
	KnownPaths   map[string]struct{}
	Events       []AgentEvent
	nextSequence int64
	CreatedAt    time.Time
	UpdatedAt    time.Time
	Canceled     bool
}

func NewSessionStore(ttl time.Duration) *SessionStore {
	if ttl <= 0 {
		ttl = 2 * time.Hour
	}
	return &SessionStore{
		now:      time.Now,
		ttl:      ttl,
		sessions: make(map[string]*Session),
	}
}

func (s *SessionStore) Create(userID string) *Session {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleanupLocked()
	now := s.now()
	session := &Session{
		ID:         uuid.NewString(),
		UserID:     userID,
		Mode:       ModeAsk,
		KnownPaths: make(map[string]struct{}),
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	s.sessions[session.ID] = session
	return cloneSession(session)
}

func (s *SessionStore) WithSession(id, userID string, fn func(session *Session) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleanupLocked()
	session := s.sessions[id]
	if session == nil || session.UserID != userID {
		return ErrSessionNotFound
	}
	if err := fn(session); err != nil {
		return err
	}
	session.UpdatedAt = s.now()
	return nil
}

func (s *SessionStore) Events(id, userID string, after int64) ([]AgentEvent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleanupLocked()
	session := s.sessions[id]
	if session == nil || session.UserID != userID {
		return nil, ErrSessionNotFound
	}
	events := make([]AgentEvent, 0, len(session.Events))
	for _, event := range session.Events {
		if event.Sequence > after {
			events = append(events, event)
		}
	}
	return events, nil
}

func (s *SessionStore) Cancel(id, userID string) error {
	return s.WithSession(id, userID, func(session *Session) error {
		session.Canceled = true
		session.appendEvent(AgentEvent{Type: EventError, Message: "session canceled"})
		return nil
	})
}

func (s *SessionStore) cleanupLocked() {
	cutoff := s.now().Add(-s.ttl)
	for id, session := range s.sessions {
		if session.UpdatedAt.Before(cutoff) {
			delete(s.sessions, id)
		}
	}
}

func (s *Session) appendEvent(event AgentEvent) {
	s.nextSequence++
	event.Sequence = s.nextSequence
	event.CreatedAt = time.Now()
	s.Events = append(s.Events, event)
}

func cloneSession(session *Session) *Session {
	cloned := *session
	cloned.Messages = append([]Message(nil), session.Messages...)
	cloned.ToolResults = append([]ToolResult(nil), session.ToolResults...)
	cloned.Events = append([]AgentEvent(nil), session.Events...)
	cloned.KnownPaths = make(map[string]struct{}, len(session.KnownPaths))
	for path := range session.KnownPaths {
		cloned.KnownPaths[path] = struct{}{}
	}
	return &cloned
}
