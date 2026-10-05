package db

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	. "github.com/kannachi323/misty/server/internal/platform/postgres"
)

func TestAgentChatsAreDirectConversationsInThePersonalSpace(t *testing.T) {
	database := openTestDatabase(t)
	ctx := context.Background()
	owner, err := database.CreateUser("Dana Lee", "agent-chat-dm@example.com", "password123")
	if err != nil {
		t.Fatal(err)
	}
	misty, err := database.EnsureAskIdentity(ctx, owner.ID, "google/gemini-2.5-flash-lite")
	if err != nil {
		t.Fatal(err)
	}
	home := personalSpace(t, database, ctx, owner.ID)
	chatID := "conversation_" + uuid.NewString()
	if err := database.CreateAgentSession(ctx, chatID, owner.ID, json.RawMessage(`{}`), time.Now().Add(time.Hour), time.Now().Add(24*time.Hour)); err != nil {
		t.Fatal(err)
	}

	find := func() *SpaceConversation {
		t.Helper()
		conversations, err := database.SpaceConversations(ctx, owner.ID, home.ID)
		if err != nil {
			t.Fatal(err)
		}
		for index := range conversations {
			if conversations[index].ID == chatID {
				return &conversations[index]
			}
		}
		return nil
	}
	dm := find()
	if dm == nil || dm.Kind != "direct" || dm.DirectUserID != owner.ID || dm.DirectAgentID != misty.ID {
		t.Fatalf("agent chat in the personal Space = %#v, want a DM with Misty", dm)
	}

	if err := database.RenameAgentSession(ctx, owner.ID, chatID, "Trip plans"); err != nil {
		t.Fatal(err)
	}
	if dm = find(); dm == nil || dm.Title != "Trip plans" {
		t.Fatalf("renamed chat = %#v", dm)
	}

	// Talking to an agent goes through its runs, never a plain message.
	if _, _, err := database.CreateSpaceConversationMessageWithReferencesAndClientNonce(ctx, owner.ID, home.ID, chatID,
		[]MessageSpan{{Type: "text", Text: "hello"}}, nil, nil, nil, "", ""); !errors.Is(err, ErrSpaceInvalid) {
		t.Fatalf("plain message into an agent chat = %v", err)
	}

	if err := database.DeleteOrClearSpaceConversation(ctx, owner.ID, home.ID, chatID); err != nil {
		t.Fatal(err)
	}
	if dm = find(); dm != nil {
		t.Fatalf("deleted DM is still listed: %#v", dm)
	}
	if _, err := database.LoadAgentSession(ctx, chatID, owner.ID); err == nil {
		t.Fatal("deleting the DM kept the agent chat")
	}
}
