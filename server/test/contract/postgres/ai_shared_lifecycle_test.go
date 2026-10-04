package db

import (
	"context"
	"encoding/json"
	"errors"
	. "github.com/kannachi323/misty/server/internal/platform/postgres"
	"sync"
	"testing"
	"time"
)

func TestSharedConversationAdmissionAndSteering(t *testing.T) {
	database := openTestDatabase(t)
	ctx := context.Background()
	user, err := database.CreateUser("Lifecycle", "lifecycle@example.invalid", "password123")
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := database.CreateAIConversation(ctx, user.ID)
	if err != nil {
		t.Fatal(err)
	}
	record := func(id string) AIInvocationRecord {
		return AIInvocationRecord{ID: "invocation_" + id, UserID: user.ID, ConversationID: conversation, SurfaceID: "global", Mode: "drawer", Trigger: "message", State: "queued", IdempotencyKey: id, RequestPayload: json.RawMessage(`{}`), ExpiresAt: time.Now().Add(time.Hour)}
	}
	var wait sync.WaitGroup
	results := make(chan error, 2)
	var winner AIInvocationRecord
	var mutex sync.Mutex
	for _, id := range []string{"one", "two"} {
		wait.Add(1)
		go func(id string) {
			defer wait.Done()
			stored, _, err := database.CreateAIInvocationRecord(ctx, record(id))
			if err == nil {
				mutex.Lock()
				winner = stored
				mutex.Unlock()
			}
			results <- err
		}(id)
	}
	wait.Wait()
	close(results)
	success, busy := 0, 0
	for err := range results {
		if err == nil {
			success++
		} else if errors.Is(err, ErrAIConversationBusy) {
			busy++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || busy != 1 {
		t.Fatalf("admission: success=%d busy=%d", success, busy)
	}
	if replay, created, err := database.CreateAIInvocationRecord(ctx, winner); err != nil || created || replay.ID != winner.ID {
		t.Fatalf("replay: %+v %v %v", replay, created, err)
	}
	payload := json.RawMessage(`{"type":"user.steering","text":"Keep invoices unchanged"}`)
	queued, err := database.CommitAIInvocationEvent(ctx, user.ID, winner.ID, "user-steering:key", "user.steering", payload, "")
	if err != nil {
		t.Fatal(err)
	}
	replay, err := database.CommitAIInvocationEvent(ctx, user.ID, winner.ID, "user-steering:key", "user.steering", payload, "")
	if err != nil || replay.Sequence != queued.Sequence {
		t.Fatal("steering replay was not idempotent", err)
	}
	batch, err := database.TakeAIInvocationSteering(ctx, user.ID, winner.ID, "0:finish", true)
	if err != nil || batch.Closed || len(batch.Messages) != 1 {
		t.Fatalf("batch=%+v error=%v", batch, err)
	}
	same, err := database.TakeAIInvocationSteering(ctx, user.ID, winner.ID, "0:finish", true)
	if err != nil || len(same.Messages) != 1 {
		t.Fatal("boundary replay lost its batch", err)
	}
	closed, err := database.TakeAIInvocationSteering(ctx, user.ID, winner.ID, "1:finish", true)
	if err != nil || !closed.Closed {
		t.Fatal("intake did not close", err)
	}
	if _, err := database.CommitAIInvocationEvent(ctx, user.ID, winner.ID, "user-steering:late", "user.steering", payload, ""); !errors.Is(err, ErrSpaceConflict) {
		t.Fatal("late message silently accepted", err)
	}
	if _, err := database.CommitAIInvocationEvent(ctx, user.ID, winner.ID, "finish", "invocation.completed", json.RawMessage(`{"type":"invocation.completed"}`), "completed"); err != nil {
		t.Fatal(err)
	}
	if _, created, err := database.CreateAIInvocationRecord(ctx, record("three")); err != nil || !created {
		t.Fatal("next task blocked", err)
	}
}
