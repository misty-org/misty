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
