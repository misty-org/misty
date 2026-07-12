package agent

import (
	"context"
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
	sessions map[string]*sessionEntry
}

type sessionEntry struct {
	mu       sync.Mutex
	cancelMu sync.Mutex
	cancel   context.CancelFunc
	userID   string
	session  *Session
	active   int
}

type Session struct {
	ID                    string
	UserID                string
	MikaTier              MikaTier
	Mode                  string
	ActiveRoot            string
	Capabilities          ToolManifest
	Messages              []Message
	ToolResults           []ToolResult
	KnownPaths            map[string]struct{}
	Events                []AgentEvent
	nextSequence          int64
	CreatedAt             time.Time
	UpdatedAt             time.Time
	Canceled              bool
	ProviderCallsThisTurn int
	PendingToolRequests   map[string]string
}

func NewSessionStore(ttl time.Duration) *SessionStore {
	if ttl <= 0 {
		ttl = 2 * time.Hour
	}
	return &SessionStore{
		now:      time.Now,
		ttl:      ttl,
		sessions: make(map[string]*sessionEntry),
	}
}

func (s *SessionStore) Create(userID string) *Session {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleanupLocked()
	now := s.now()
	session := &Session{
		ID:                  uuid.NewString(),
		UserID:              userID,
		MikaTier:            MikaLow,
		Mode:                ModeAsk,
		KnownPaths:          make(map[string]struct{}),
		PendingToolRequests: make(map[string]string),
		CreatedAt:           now,
		UpdatedAt:           now,
	}
	s.sessions[session.ID] = &sessionEntry{userID: userID, session: session}
	return cloneSession(session)
}

func (s *SessionStore) WithSession(id, userID string, fn func(session *Session) error) error {
	return s.WithSessionContext(context.Background(), id, userID, func(_ context.Context, session *Session) error {
		return fn(session)
	})
}

func (s *SessionStore) WithSessionContext(ctx context.Context, id, userID string, fn func(context.Context, *Session) error) error {
	s.mu.Lock()
	s.cleanupLocked()
	entry := s.sessions[id]
	if entry != nil {
		entry.active++
	}
	s.mu.Unlock()
	if entry == nil {
		return ErrSessionNotFound
	}
	defer s.releaseEntry(entry)
	entry.mu.Lock()
	defer entry.mu.Unlock()
	if entry.session.UserID != userID {
		return ErrSessionNotFound
	}
	requestCtx, cancel := context.WithCancel(ctx)
	entry.cancelMu.Lock()
	entry.cancel = cancel
	entry.cancelMu.Unlock()
	defer func() {
		entry.cancelMu.Lock()
		entry.cancel = nil
		entry.cancelMu.Unlock()
		cancel()
	}()
	if err := fn(requestCtx, entry.session); err != nil {
		return err
	}
	entry.session.UpdatedAt = s.now()
	return nil
}

func (s *SessionStore) Events(id, userID string, after int64) ([]AgentEvent, error) {
	s.mu.Lock()
	s.cleanupLocked()
	entry := s.sessions[id]
	if entry != nil {
		entry.active++
	}
	s.mu.Unlock()
	if entry == nil {
		return nil, ErrSessionNotFound
	}
	defer s.releaseEntry(entry)
	entry.mu.Lock()
	defer entry.mu.Unlock()
	session := entry.session
	if session.UserID != userID {
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

func (s *SessionStore) releaseEntry(entry *sessionEntry) {
	s.mu.Lock()
	entry.active--
	s.mu.Unlock()
}

func (s *SessionStore) Cancel(id, userID string) error {
	s.mu.Lock()
	s.cleanupLocked()
	entry := s.sessions[id]
	if entry != nil {
		entry.active++
	}
	s.mu.Unlock()
	if entry == nil || entry.userID != userID {
		if entry != nil {
			s.releaseEntry(entry)
		}
		return ErrSessionNotFound
	}
	defer s.releaseEntry(entry)

	entry.cancelMu.Lock()
	if entry.cancel != nil {
		entry.cancel()
	}
	entry.cancelMu.Unlock()

	entry.mu.Lock()
	defer entry.mu.Unlock()
	if !entry.session.Canceled {
		entry.session.Canceled = true
		entry.session.appendEvent(AgentEvent{Type: EventError, Message: "session canceled"})
	}
	entry.session.UpdatedAt = s.now()
	return nil
}

func (s *SessionStore) cleanupLocked() {
	cutoff := s.now().Add(-s.ttl)
	for id, entry := range s.sessions {
		if entry.active > 0 {
			continue
		}
		// An active provider call owns the entry lock. Skip it so cleanup never
		// blocks unrelated session creation or lookups behind network latency.
		if !entry.mu.TryLock() {
			continue
		}
		expired := entry.session.UpdatedAt.Before(cutoff)
		entry.mu.Unlock()
		if expired {
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
	cloned.PendingToolRequests = make(map[string]string, len(session.PendingToolRequests))
	for id, name := range session.PendingToolRequests {
		cloned.PendingToolRequests[id] = name
	}
	return &cloned
}
