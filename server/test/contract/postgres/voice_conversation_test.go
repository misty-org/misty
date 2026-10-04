package db

import (
	"encoding/json"
	"github.com/google/uuid"
	. "github.com/kannachi323/misty/server/internal/platform/postgres"
	"testing"
	"time"
)

func TestVoiceConversationHistoryIsOwnedDurableAndDoesNotDispatchWork(t *testing.T) {
	database := openTestDatabase(t)
	ctx := t.Context()
	owner, err := database.CreateUser("Voice history", "voice-"+uuid.NewString()+"@example.test", "password123")
	if err != nil {
		t.Fatal(err)
	}
	other, err := database.CreateUser("Other", "voice-"+uuid.NewString()+"@example.test", "password123")
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := database.CreateAIConversation(ctx, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	active := "invocation_" + uuid.NewString()
	_, _, err = database.CreateAIInvocationRecord(ctx, AIInvocationRecord{ID: active, UserID: owner.ID, ConversationID: conversation, SurfaceID: "companion", Mode: "companion", Trigger: "message", State: "queued", IdempotencyKey: active, RequestPayload: json.RawMessage(`{"prompt":"Do work"}`), ExpiresAt: time.Now().Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	id := "voice-" + uuid.NewString()
	started := time.Now()
	if err = database.SaveVoiceConversationTurn(ctx, other.ID, conversation, id, "Hi", "Hello", false, started); err == nil {
		t.Fatal("foreign voice write")
	}
	if err = database.SaveVoiceConversationTurn(ctx, owner.ID, conversation, id, "Hi", "", false, started); err != nil {
		t.Fatal(err)
	}
	turns, err := database.AIConversationTurns(ctx, owner.ID, conversation)
	if err != nil || len(turns) != 2 || turns[1].Prompt != "Hi" {
		t.Fatal("input not durable", turns, err)
	}
	for i := 0; i < 2; i++ {
		if err = database.SaveVoiceConversationTurn(ctx, owner.ID, conversation, id, "Hi", "Hello", false, started); err != nil {
			t.Fatal(err)
		}
	}
	turns, err = database.AIConversationTurns(ctx, owner.ID, conversation)
	if err != nil || len(turns) != 2 || turns[1].Reply != "Hello" {
		t.Fatal("duplicate or missing voice reply", turns, err)
	}
	if err = database.SaveVoiceConversationTurn(ctx, owner.ID, conversation, id, "different", "bad", false, started); err == nil {
		t.Fatal("receipt rewritten")
	}
	events, state, err := database.AIInvocationEvents(ctx, owner.ID, id, 0)
	if err != nil || state != "completed" || len(events) != 2 {
		t.Fatal("voice receipt state", state, err)
	}
	task, err := database.AIInvocationByID(ctx, owner.ID, active)
	if err != nil || task.State != "queued" {
		t.Fatal("speech changed task", err)
	}
	var count int
	if err = database.Conn.QueryRow(`SELECT count(*) FROM agent_runtime_deliveries WHERE run_id=$1`, id).Scan(&count); err != nil || count != 0 {
		t.Fatal("speech dispatched work", err)
	}
}

func TestVoiceConversationFailureIsDurableAndCannotRewriteSuccess(t *testing.T) {
	database := openTestDatabase(t)
	ctx := t.Context()
	owner, err := database.CreateUser("Voice failure", "voice-"+uuid.NewString()+"@example.test", "password123")
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := database.CreateAIConversation(ctx, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	id, started := "voice-"+uuid.NewString(), time.Now()
	if err = database.SaveVoiceConversationTurn(ctx, owner.ID, conversation, id, "Hi", "", false, started); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err = database.SaveVoiceConversationFailure(ctx, owner.ID, conversation, id, "Hi", "Billing did not authorize this response.", started); err != nil {
			t.Fatal(err)
		}
	}
	turns, err := database.AIConversationTurns(ctx, owner.ID, conversation)
	if err != nil || len(turns) != 1 || turns[0].State != "failed" || turns[0].Reply != "" || turns[0].Failure != "Billing did not authorize this response." {
		t.Fatal("failure projection", turns, err)
	}
	if err = database.SaveVoiceConversationFailure(ctx, owner.ID, conversation, id, "different", "bad", started); err == nil {
		t.Fatal("rewrote another prompt")
	}
	success := "voice-" + uuid.NewString()
	if err = database.SaveVoiceConversationTurn(ctx, owner.ID, conversation, success, "Hello", "Hello back", false, started); err != nil {
		t.Fatal(err)
	}
	if err = database.SaveVoiceConversationFailure(ctx, owner.ID, conversation, success, "Hello", "late failure", started); err != nil {
		t.Fatal(err)
	}
	row, err := database.AIInvocationByID(ctx, owner.ID, success)
	if err != nil || row.State != "completed" {
		t.Fatal("failure rewrote successful receipt", row, err)
	}
}

func TestVoiceAndDrawerHistoryFollowConversationRetentionNotTransientExpiry(t *testing.T) {
	database := openTestDatabase(t)
	ctx := t.Context()
	owner, err := database.CreateUser("Retained history", "retained-"+uuid.NewString()+"@example.test", "password123")
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := database.CreateAIConversation(ctx, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	expired := time.Now().Add(-48 * time.Hour)
	voiceID := "voice-" + uuid.NewString()
	if err = database.SaveVoiceConversationTurn(ctx, owner.ID, conversation, voiceID, "Remember this conversation", "This reply is durable.", false, time.Now()); err != nil {
		t.Fatal(err)
	}
	createExpired := func(mode string) string {
		t.Helper()
		id := "invocation_" + uuid.NewString()
		_, _, e := database.CreateAIInvocationRecord(ctx, AIInvocationRecord{ID: id, UserID: owner.ID, ConversationID: conversation, SurfaceID: "global", Mode: mode, Trigger: "message", State: "queued", IdempotencyKey: id, RequestPayload: json.RawMessage(`{"prompt":"Stored conversation or inline transform"}`), ExpiresAt: expired})
		if e != nil {
			t.Fatal(e)
		}
		if e = database.AppendAIInvocationEvent(ctx, owner.ID, id, 1, "assistant.message", json.RawMessage(`{"text":"Stored answer"}`), "completed"); e != nil {
			t.Fatal(e)
		}
		return id
	}
	drawerID := createExpired("drawer")
	inlineID := createExpired("quick")
	appliedID := createExpired("quick")
	artifactID := "artifact_" + uuid.NewString()
	artifact, _ := json.Marshal(map[string]any{"id": artifactID, "schemaVersion": 1, "kind": "text_patch", "title": "Applied edit", "summary": "Preserve applied artifact history", "sources": []any{}, "operations": map[string]any{}, "risk": "draft", "approvalPolicy": "visible_apply", "idempotencyKey": artifactID, "state": "applied", "expiresAt": expired.Format(time.RFC3339)})
	if err = database.UpsertAIArtifact(ctx, owner.ID, appliedID, artifact); err != nil {
		t.Fatal(err)
	}
	// Make both clocks explicit: execution authority has expired for every row,
	// while the user's conversation remains retained for another seven days.
	if _, err = database.Conn.Exec(`UPDATE ai_invocations SET expires_at=$1 WHERE conversation_id=$2`, expired, conversation); err != nil {
		t.Fatal(err)
	}
	if _, err = database.Conn.Exec(`UPDATE misty_ask_conversations SET retention_expires_at=NOW()+INTERVAL '7 days' WHERE id=$1`, conversation); err != nil {
		t.Fatal(err)
	}
	purged, err := database.PurgeExpiredAITransients(ctx, 100)
	if err != nil || purged != 1 {
		t.Fatal("only expired inline transform should be purged", purged, err)
	}
	for _, id := range []string{voiceID, drawerID, appliedID} {
		row, e := database.AIInvocationByID(ctx, owner.ID, id)
		if e != nil {
			t.Fatalf("retained history %s was purged: %v", id, e)
		}
		if row.ExpiresAt.After(time.Now()) {
			t.Fatal("retaining history renewed execution authority")
		}
	}
	if _, err = database.AIInvocationByID(ctx, owner.ID, inlineID); err == nil {
		t.Fatal("inline transform inherited conversation retention")
	}
	turns, err := database.AIConversationTurns(ctx, owner.ID, conversation)
	if err != nil {
		t.Fatal(err)
	}
	voiceFound, drawerFound := false, false
	for _, turn := range turns {
		if turn.InvocationID == voiceID && turn.Reply == "This reply is durable." {
			voiceFound = true
		}
		if turn.InvocationID == drawerID && turn.Reply == "Stored answer" {
			drawerFound = true
		}
	}
	if !voiceFound || !drawerFound {
		t.Fatal("retained history lost its saved messages", voiceFound, drawerFound)
	}

	// A shorter account retention preference must win over a still-future
	// conversation deadline. Only this fixture's older drawer turn is eligible.
	oldDrawerID := createExpired("drawer")
	if _, err = database.Conn.Exec(`UPDATE ai_invocations SET created_at=NOW()-INTERVAL '2 days' WHERE id=$1`, oldDrawerID); err != nil {
		t.Fatal(err)
	}
	if _, err = database.UpdateAISettings(ctx, owner.ID, true, 1, true, false); err != nil {
		t.Fatal(err)
	}
	purged, err = database.PurgeExpiredAITransients(ctx, 100)
	if err != nil || purged != 1 {
		t.Fatal("account retention did not override conversation deadline", purged, err)
	}
	if _, err = database.AIInvocationByID(ctx, owner.ID, oldDrawerID); err == nil {
		t.Fatal("old drawer outlived one-day account retention")
	}
	for _, id := range []string{voiceID, drawerID, appliedID} {
		if _, e := database.AIInvocationByID(ctx, owner.ID, id); e != nil {
			t.Fatal("fresh history or applied artifact purged with older turn", id, e)
		}
	}
	if _, err = database.Conn.Exec(`UPDATE misty_ask_conversations SET retention_expires_at=NOW()-INTERVAL '1 hour' WHERE id=$1`, conversation); err != nil {
		t.Fatal(err)
	}
	purged, err = database.PurgeExpiredAITransients(ctx, 100)
	if err != nil || purged != 2 {
		t.Fatal("expired conversation did not release voice and drawer history", purged, err)
	}
	for _, id := range []string{voiceID, drawerID} {
		if _, e := database.AIInvocationByID(ctx, owner.ID, id); e == nil {
			t.Fatal("expired conversation history survived", id)
		}
	}
	if _, err = database.AIInvocationByID(ctx, owner.ID, appliedID); err != nil {
		t.Fatal("applied artifact lost its existing retention protection", err)
	}
	if _, err = database.AIArtifactByID(ctx, owner.ID, artifactID); err != nil {
		t.Fatal("applied artifact was removed", err)
	}
}
