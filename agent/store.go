package agent

import (
	"context"
	"errors"
	"log"
	"strings"
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
	persist  SessionPersistence
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
	BillingUserID         string
	BillingScope          string
	ModelID               string
	ReasoningEffort       string
	SystemPrompt          string
	AllowTools            bool
	AllowWriteTools       bool
	AgentTier              AgentTier
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
	return NewSessionStoreWithPersistence(ttl, nil)
}

func NewSessionStoreWithPersistence(ttl time.Duration, persistence SessionPersistence) *SessionStore {
	if ttl <= 0 {
		ttl = 2 * time.Hour
	}
	return &SessionStore{
		now:      time.Now,
		ttl:      ttl,
		sessions: make(map[string]*sessionEntry),
		persist:  persistence,
	}
}

func (s *SessionStore) Create(userID string) *Session {
	return s.CreateWithBilling(userID, userID)
}

func (s *SessionStore) CreateWithBilling(userID, billingUserID string) *Session {
	return s.CreateWithBillingScope(userID, billingUserID, "")
}

func (s *SessionStore) CreateWithModel(userID, billingUserID, modelID string) *Session {
	session := s.CreateWithBillingScope(userID, billingUserID, "")
	_ = s.WithSession(session.ID, userID, func(current *Session) error {
		current.ModelID = strings.TrimSpace(modelID)
		return nil
	})
	session.ModelID = strings.TrimSpace(modelID)
	return session
}

func (s *SessionStore) CreateWithBillingScope(userID, billingUserID, billingScope string) *Session {
	s.mu.Lock()
	s.cleanupLocked()
	now := s.now()
	session := &Session{
		ID:                  "conversation_" + uuid.NewString(),
		UserID:              userID,
		BillingUserID:       billingUserID,
		BillingScope:        billingScope,
		AgentTier:            TierLow,
		Mode:                ModeAsk,
		AllowTools:          true,
		AllowWriteTools:     true,
		KnownPaths:          make(map[string]struct{}),
		PendingToolRequests: make(map[string]string),
		CreatedAt:           now,
		UpdatedAt:           now,
	}
	s.sessions[session.ID] = &sessionEntry{userID: userID, session: session}
	s.mu.Unlock()
	s.persistCreatedSession(session)
	return cloneSession(session)
}

func (s *SessionStore) WithSession(id, userID string, fn func(session *Session) error) error {
	return s.WithSessionContext(context.Background(), id, userID, func(_ context.Context, session *Session) error {
		return fn(session)
	})
}

func (s *SessionStore) WithSessionContext(ctx context.Context, id, userID string, fn func(context.Context, *Session) error) error {
	entry := s.acquireEntry(ctx, id, userID)
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
	beforeMessages := len(entry.session.Messages)
	beforeResults := len(entry.session.ToolResults)
	beforeEvents := len(entry.session.Events)
	if err := fn(requestCtx, entry.session); err != nil {
		return err
	}
	entry.session.UpdatedAt = s.now()
	s.persistUpdatedSession(ctx, entry.session, persistentEvents(beforeMessages, beforeResults, beforeEvents, entry.session))
	return nil
}

func (s *SessionStore) Events(id, userID string, after int64) ([]AgentEvent, error) {
	entry := s.acquireEntry(context.Background(), id, userID)
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
	entry := s.acquireEntry(context.Background(), id, userID)
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
	beforeEvents := len(entry.session.Events)
	if !entry.session.Canceled {
		entry.session.Canceled = true
		entry.session.appendEvent(AgentEvent{Type: EventError, Message: "session canceled"})
	}
	entry.session.UpdatedAt = s.now()
	s.persistUpdatedSession(context.Background(), entry.session, persistentEvents(len(entry.session.Messages), len(entry.session.ToolResults), beforeEvents, entry.session))
	return nil
}

// Forget removes an owned session from process memory after its durable
// conversation has been deleted by the account owner.
func (s *SessionStore) Forget(id, userID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry := s.sessions[id]
	if entry == nil || entry.userID != userID {
		return ErrSessionNotFound
	}
	entry.cancelMu.Lock()
	if entry.cancel != nil {
		entry.cancel()
	}
	entry.cancelMu.Unlock()
	delete(s.sessions, id)
	return nil
}

func (s *SessionStore) acquireEntry(ctx context.Context, id, userID string) *sessionEntry {
	s.mu.Lock()
	s.cleanupLocked()
	entry := s.sessions[id]
	if entry != nil {
		entry.active++
		s.mu.Unlock()
		return entry
	}
	s.mu.Unlock()

	if s.persist == nil {
		return nil
	}
	raw, err := s.persist.LoadAgentSession(ctx, id, userID)
	if err != nil {
		if !errors.Is(err, ErrPersistedSessionNotFound) {
			log.Printf("load persisted agent session %q: %v", id, err)
		}
		return nil
	}
	// Staleness here is measured against retention, not the in-memory ttl: ttl
	// only decides how long a session stays cached in this process, while a
	// persisted session stays resumable — including from another device — for as
	// long as it is retained.
	session, err := unmarshalPersistentSession(raw, id, userID)
	if err != nil || session.UpdatedAt.Before(s.now().Add(-conversationRetention)) {
		if err != nil && !errors.Is(err, ErrPersistedSessionNotFound) {
			log.Printf("decode persisted agent session %q: %v", id, err)
		}
		return nil
	}
	loaded := &sessionEntry{userID: userID, session: session, active: 1}
	s.mu.Lock()
	if existing := s.sessions[id]; existing != nil {
		existing.active++
		entry = existing
	} else {
		s.sessions[id] = loaded
		entry = loaded
	}
	s.mu.Unlock()
	return entry
}

func (s *SessionStore) persistCreatedSession(session *Session) {
	if s.persist == nil {
		return
	}
	state, err := marshalPersistentSession(session)
	if err == nil {
		err = s.persist.CreateAgentSession(context.Background(), session.ID, session.UserID, state, session.UpdatedAt.Add(s.ttl), session.UpdatedAt.Add(conversationRetention))
	}
	if err != nil {
		log.Printf("persist new agent session %q: %v", session.ID, err)
	}
}

func (s *SessionStore) persistUpdatedSession(ctx context.Context, session *Session, events []PersistedConversationEvent) {
	if s.persist == nil {
		return
	}
	state, err := marshalPersistentSession(session)
	if err == nil {
		err = s.persist.SaveAgentSession(ctx, session.ID, session.UserID, state, events, session.UpdatedAt.Add(s.ttl), session.UpdatedAt.Add(conversationRetention))
	}
	if err != nil {
		log.Printf("persist agent session %q: %v", session.ID, err)
	}
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
