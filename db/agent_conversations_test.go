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

func TestAgentSessionPersistenceSurvivesUnifiedAgentSchema(t *testing.T) {
	database := openTestDatabase(t)
	ctx := context.Background()
	user, err := database.CreateUser("Agent Session Owner", "agent-session@example.com", "correct horse battery staple")
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

func TestAgentSessionsAreListableRenamableAndResumableAcrossDevices(t *testing.T) {
	database := openTestDatabase(t)
	ctx := context.Background()
	user, err := database.CreateUser("Agent Rail Owner", "agent-rail@example.com", "correct horse battery staple")
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

func TestAgentSpaceSessionAccessIsRevalidated(t *testing.T) {
	database := openTestDatabase(t)
	ctx := context.Background()
	owner, err := database.CreateUser("Session Access Owner", "session-access-owner@example.com", "password123")
	if err != nil {
		t.Fatal(err)
	}
	member, err := database.CreateUser("Session Access Member", "session-access-member@example.com", "password123")
	if err != nil {
		t.Fatal(err)
	}
	space, err := database.CreateSpace(ctx, owner.ID, "Session Access Space")
	if err != nil {
		t.Fatal(err)
	}
	invite, err := database.InviteToSpace(ctx, owner.ID, space.ID, member.Email)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.RespondToSpaceInvite(ctx, member.ID, invite.ID, true); err != nil {
		t.Fatal(err)
	}
	personal, err := database.CreatePersonalAgent(ctx, owner.ID, PersonalAgent{
		Name: "Shared Agent", Instructions: "Help with the Space.", ModelMode: "pinned", ModelID: "google/gemini-2.5-flash-lite",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.ReplacePersonalAgentGrants(ctx, owner.ID, personal.ID, []PersonalAgentGrantInput{{
		SpaceID: space.ID, MemberUserIDs: []string{member.ID},
	}}); err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC()
	agentSessionID := "conversation_" + uuid.NewString()
	if err := database.CreateAgentSession(ctx, agentSessionID, member.ID, json.RawMessage(`{}`), now.Add(time.Hour), now.Add(24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := database.BindAgentSessionContext(ctx, member.ID, agentSessionID, personal.ID, space.ID, "", "test"); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ValidateAgentSessionAccess(ctx, member.ID, agentSessionID); err != nil {
		t.Fatalf("ValidateAgentSessionAccess() before revocation = %v", err)
	}
	if _, err := database.ReplacePersonalAgentGrants(ctx, owner.ID, personal.ID, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ValidateAgentSessionAccess(ctx, member.ID, agentSessionID); !errors.Is(err, ErrPersonalAgentNotFound) {
		t.Fatalf("ValidateAgentSessionAccess() after grant revocation = %v, want ErrPersonalAgentNotFound", err)
	}

	directSessionID := "conversation_" + uuid.NewString()
	if err := database.CreateAgentSession(ctx, directSessionID, member.ID, json.RawMessage(`{}`), now.Add(time.Hour), now.Add(24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := database.BindAgentSessionContext(ctx, member.ID, directSessionID, "", space.ID, "", "test"); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ValidateAgentSessionAccess(ctx, member.ID, directSessionID); err != nil {
		t.Fatalf("ValidateAgentSessionAccess() before member removal = %v", err)
	}
	if err := database.RemoveSpaceMember(ctx, owner.ID, space.ID, member.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ValidateAgentSessionAccess(ctx, member.ID, directSessionID); !errors.Is(err, ErrLibraryForbidden) {
		t.Fatalf("ValidateAgentSessionAccess() after member removal = %v, want ErrLibraryForbidden", err)
	}
}

// The client sends space_id on every message, but a session is bound to its
// Space when it is created. Callers must use the bound value: if the request
// were trusted, a member of one Space could read another Space's context by
// sending a different id on a session bound elsewhere.
func TestAgentSessionAccessReturnsTheBoundSpace(t *testing.T) {
	database := openTestDatabase(t)
	ctx := context.Background()
	owner, err := database.CreateUser("Bound Space Owner", "bound-space-owner@example.com", "password123")
	if err != nil {
		t.Fatal(err)
	}
	bound, err := database.CreateSpace(ctx, owner.ID, "Bound Space")
	if err != nil {
		t.Fatal(err)
	}
	other, err := database.CreateSpace(ctx, owner.ID, "Other Space")
	if err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC()
	sessionID := "conversation_" + uuid.NewString()
	if err := database.CreateAgentSession(ctx, sessionID, owner.ID, json.RawMessage(`{}`), now.Add(time.Hour), now.Add(24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := database.BindAgentSessionContext(ctx, owner.ID, sessionID, "", bound.ID, "", "test"); err != nil {
		t.Fatal(err)
	}

	got, err := database.ValidateAgentSessionAccess(ctx, owner.ID, sessionID)
	if err != nil {
		t.Fatalf("ValidateAgentSessionAccess() error = %v", err)
	}
	if got.SpaceID != bound.ID {
		t.Fatalf("SpaceID = %q, want the bound Space %q", got.SpaceID, bound.ID)
	}
	if got.SpaceID == other.ID {
		t.Fatal("SpaceID resolved to a Space the session was never bound to")
	}
	if got.AgentID != "" {
		t.Fatalf("AgentID = %q, want empty for a direct session", got.AgentID)
	}

	// A session with no Space returns an empty context rather than erroring, so
	// the Files-scoped path keeps working.
	filesSessionID := "conversation_" + uuid.NewString()
	if err := database.CreateAgentSession(ctx, filesSessionID, owner.ID, json.RawMessage(`{}`), now.Add(time.Hour), now.Add(24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	filesContext, err := database.ValidateAgentSessionAccess(ctx, owner.ID, filesSessionID)
	if err != nil {
		t.Fatalf("ValidateAgentSessionAccess() for a Files session error = %v", err)
	}
	if filesContext.SpaceID != "" {
		t.Fatalf("SpaceID = %q, want empty for a session with no Space", filesContext.SpaceID)
	}
}
