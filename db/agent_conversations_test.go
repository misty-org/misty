package db

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	serveragent "github.com/kannachi323/misty/server/agent"
)

func TestMikaSessionPersistenceSurvivesUnifiedAgentSchema(t *testing.T) {
	database := openTestDatabase(t)
	ctx := context.Background()
	user, err := database.CreateUser("Mika Session Owner", "mika-session@example.com", "correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	conversationID := "conversation_" + uuid.NewString()
	if err := database.CreateAgentSession(ctx, conversationID, user.ID, json.RawMessage(`{"turn":1}`), now.Add(time.Hour), now.Add(24*time.Hour)); err != nil {
		t.Fatalf("CreateAgentSession() error = %v", err)
	}
	if err := database.SaveAgentSession(ctx, conversationID, user.ID, json.RawMessage(`{"turn":2}`), []serveragent.PersistedConversationEvent{{Type: "assistant_message", Data: json.RawMessage(`{"text":"done"}`)}}, now.Add(time.Hour), now.Add(24*time.Hour)); err != nil {
		t.Fatalf("SaveAgentSession() error = %v", err)
	}
	state, err := database.LoadAgentSession(ctx, conversationID, user.ID)
	var stateValue map[string]int
	decodeErr := json.Unmarshal(state, &stateValue)
	if err != nil || decodeErr != nil || stateValue["turn"] != 2 {
		t.Fatalf("LoadAgentSession() = %s, %v", state, err)
	}

	expiredID := "conversation_" + uuid.NewString()
	if err := database.CreateAgentSession(ctx, expiredID, user.ID, json.RawMessage(`{}`), now.Add(time.Hour), now.Add(-time.Minute)); err != nil {
		t.Fatalf("CreateAgentSession(expired) error = %v", err)
	}
	deleted, err := database.PurgeExpiredAgentConversations(ctx)
	if err != nil || deleted != 1 {
		t.Fatalf("PurgeExpiredAgentConversations() = %d, %v", deleted, err)
	}
	if _, err := database.LoadAgentSession(ctx, expiredID, user.ID); !errors.Is(err, serveragent.ErrPersistedSessionNotFound) {
		t.Fatalf("expired session load error = %v", err)
	}
}

func TestMikaSessionsAreListableRenamableAndResumableAcrossDevices(t *testing.T) {
	database := openTestDatabase(t)
	ctx := context.Background()
	user, err := database.CreateUser("Mika Rail Owner", "mika-rail@example.com", "correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()

	// A session whose runtime cache window lapsed hours ago but which is still
	// retained: this is the cross-device case, where the device that opens it
	// never held it in memory.
	staleID := "conversation_" + uuid.NewString()
	if err := database.CreateAgentSession(ctx, staleID, user.ID, json.RawMessage(`{"turn":1}`), now.Add(-2*time.Hour), now.Add(720*time.Hour)); err != nil {
		t.Fatalf("CreateAgentSession(stale) error = %v", err)
	}
	if _, err := database.LoadAgentSession(ctx, staleID, user.ID); err != nil {
		t.Fatalf("LoadAgentSession(past active_until) error = %v, want the session to still load", err)
	}

	freshID := "conversation_" + uuid.NewString()
	if err := database.CreateAgentSession(ctx, freshID, user.ID, json.RawMessage(`{}`), now.Add(time.Hour), now.Add(720*time.Hour)); err != nil {
		t.Fatalf("CreateAgentSession(fresh) error = %v", err)
	}

	if err := database.RenameAgentSession(ctx, user.ID, staleID, "Rename batch"); err != nil {
		t.Fatalf("RenameAgentSession() error = %v", err)
	}

	sessions, err := database.ListAgentSessions(ctx, user.ID)
	if err != nil {
		t.Fatalf("ListAgentSessions() error = %v", err)
	}
	if len(sessions) != 2 {
		t.Fatalf("ListAgentSessions() returned %d sessions, want 2", len(sessions))
	}
	byID := map[string]AgentSessionSummary{}
	for _, session := range sessions {
		byID[session.ID] = session
	}
	if got := byID[staleID]; got.Title != "Rename batch" || got.Active {
		t.Fatalf("stale session = %#v, want the new title and Active=false", got)
	}
	if got := byID[freshID]; !got.Active {
		t.Fatalf("fresh session = %#v, want Active=true", got)
	}

	// Renaming must not reorder the rail: recency tracks conversation activity.
	if sessions[0].ID != freshID {
		t.Fatalf("sessions[0].ID = %q, want the more recently updated session %q", sessions[0].ID, freshID)
	}

	if err := database.RenameAgentSession(ctx, user.ID, "conversation_"+uuid.NewString(), "nope"); !errors.Is(err, serveragent.ErrPersistedSessionNotFound) {
		t.Fatalf("RenameAgentSession(unknown) error = %v, want ErrPersistedSessionNotFound", err)
	}
}
