package db

import (
	"encoding/json"
	"github.com/google/uuid"
	"testing"
	"time"
	. "github.com/kannachi323/misty/server/internal/platform/postgres"
)


import ()

func TestAgentMethodVersionsOwnershipAndSchedulePin(t *testing.T) {
	database := openTestDatabase(t)
	ctx := t.Context()
	owner, err := database.CreateUser("Method owner", "method-"+uuid.NewString()+"@example.test", "password123")
	if err != nil {
		t.Fatal(err)
	}
	other, err := database.CreateUser("Other", "method-"+uuid.NewString()+"@example.test", "password123")
	if err != nil {
		t.Fatal(err)
	}
	agent, err := database.SavePersonalAgent(ctx, owner.ID, "", AgentProfileInput{Name: "Research", Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	definition := AgentMethodDefinition{Title: "Weekly brief", Instructions: "Describe the weather.", Target: "cloud", Inputs: []AgentMethodInput{}, RequiredTools: []string{}}
	first, err := database.SaveAgentMethod(ctx, owner.ID, AgentMethod{AgentID: agent.ID, Kind: "workflow", Enabled: true, Definition: definition}, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.AgentMethodVersion(ctx, other.ID, first.VersionID); err == nil {
		t.Fatal("foreign version read")
	}
	if _, err := database.SaveAgentMethod(ctx, other.ID, AgentMethod{AgentID: agent.ID, Kind: "workflow", Enabled: true, Definition: definition}, 0); err == nil {
		t.Fatal("foreign agent method")
	}
	changed := first
	changed.Definition.Instructions = "Describe tomorrow's weather."
	second, err := database.SaveAgentMethod(ctx, owner.ID, changed, first.Version)
	if err != nil {
		t.Fatal(err)
	}
	if second.Version != 2 || second.VersionID == first.VersionID {
		t.Fatal("not a new immutable version")
	}
	original, err := database.AgentMethodVersion(ctx, owner.ID, first.VersionID)
	if err != nil || original.Definition.Instructions != definition.Instructions {
		t.Fatal("old version changed", err)
	}
	if _, err := database.SaveAgentMethod(ctx, owner.ID, changed, first.Version); err == nil {
		t.Fatal("stale edit accepted")
	}
	conversation, err := database.CreatePersonalAgentConversation(ctx, owner.ID, "", agent.ID)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	schedule, err := database.CreateScheduledTask(ctx, owner.ID, conversation, ScheduledTask{Title: first.Definition.Title, Prompt: definition.Instructions, Enabled: true, MethodVersionID: first.VersionID, MethodInputs: map[string]any{}, ScheduledTaskSchedule: ScheduledTaskSchedule{Cadence: "daily", LocalTime: "09:00", Weekday: 1, MonthDay: 1, Timezone: "UTC"}}, now)
	if err != nil {
		t.Fatal(err)
	}
	saved, err := database.ScheduledTaskByID(ctx, owner.ID, schedule.ID)
	if err != nil || saved.MethodVersionID != first.VersionID {
		t.Fatal("schedule lost version", err)
	}
	if _, err := database.ScheduledTaskByID(ctx, other.ID, schedule.ID); err == nil {
		t.Fatal("foreign schedule")
	}
	saved.Enabled = false
	updated, err := database.UpdateScheduledTask(ctx, owner.ID, *saved, now)
	if err != nil || updated.MethodVersionID != first.VersionID {
		t.Fatal("edit changed pin", err)
	}
	second.Enabled = false
	if _, err := database.SaveAgentMethod(ctx, owner.ID, second, second.Version); err != nil {
		t.Fatal(err)
	}
	old, err := database.AgentMethodVersion(ctx, owner.ID, first.VersionID)
	if err != nil || old.Enabled {
		t.Fatal("revocation not visible to pinned version", err)
	}
	// A repeated occurrence retains its original invocation and cannot create a second effect.
	payload, _ := json.Marshal(map[string]any{"prompt": definition.Instructions, "method_version_id": first.VersionID})
	record := AIInvocationRecord{ID: "invocation_" + uuid.NewString(), UserID: owner.ID, ConversationID: conversation, SurfaceID: "global", Mode: "drawer", Trigger: "schedule", State: "queued", IdempotencyKey: "method-test:" + schedule.ID, RequestPayload: payload, ExpiresAt: now.Add(time.Hour)}
	one, created, err := database.CreateAIInvocationRecord(ctx, record)
	if err != nil || !created {
		t.Fatal(err)
	}
	record.ID = "invocation_" + uuid.NewString()
	two, created, err := database.CreateAIInvocationRecord(ctx, record)
	if err != nil || created || two.ID != one.ID {
		t.Fatal("duplicate occurrence", err)
	}

	// Only completed output from this agent can establish reusable-method provenance.
	proposal := AgentMethod{AgentID: agent.ID, Kind: "template", Enabled: true, Definition: definition, SourceInvocationID: one.ID}
	if _, err := database.SaveAgentMethod(ctx, owner.ID, proposal, 0); err == nil {
		t.Fatal("unfinished invocation accepted as a completed source")
	}
	if err := database.TestingAppendAIInvocationEvent(ctx, owner.ID, one.ID, 1, "assistant.message", json.RawMessage(`{"text":"Verified brief"}`), "completed"); err != nil {
		t.Fatal(err)
	}
	derived, err := database.SaveAgentMethod(ctx, owner.ID, proposal, 0)
	if err != nil || derived.SourceInvocationID != one.ID {
		t.Fatal("completed source not preserved", err)
	}
	secondAgent, err := database.SavePersonalAgent(ctx, owner.ID, "", AgentProfileInput{Name: "Another agent", Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	proposal.AgentID = secondAgent.ID
	if _, err := database.SaveAgentMethod(ctx, owner.ID, proposal, 0); err == nil {
		t.Fatal("another agent's output accepted as provenance")
	}
}
