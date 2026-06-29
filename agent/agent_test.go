package agent

import (
	"encoding/json"
	"testing"
	"time"
)

func TestAgentLoopToolResultToFilePlan(t *testing.T) {
	service := NewService(NewSessionStore(0), MockProvider{})
	session := service.CreateSession("user-1")

	err := service.SendMessage(session.ID, "user-1", AgentMessageRequest{
		Mode:        ModeAuto,
		UserMessage: "Organize this desktop folder",
		ActiveRoot:  "Desktop",
		Capabilities: ToolManifest{Tools: []ToolDefinition{
			{Name: ToolListDirectory, Risk: RiskRead},
		}},
	})
	if err != nil {
		t.Fatalf("SendMessage() error = %v", err)
	}

	events, err := service.Events(session.ID, "user-1", 0)
	if err != nil {
		t.Fatalf("Events() error = %v", err)
	}
	if len(events) != 2 {
		t.Fatalf("initial events len = %d, want 2: %#v", len(events), events)
	}
	if events[1].Type != EventToolRequest || len(events[1].ToolRequests) != 1 {
		t.Fatalf("expected tool request event, got %#v", events[1])
	}
	if events[1].ToolRequests[0].ApprovalRequired {
		t.Fatalf("auto read tool should not require approval: %#v", events[1].ToolRequests[0])
	}

	result, _ := json.Marshal(map[string]any{
		"entries": []map[string]any{
			{"name": "invoice.pdf"},
			{"name": "photo.png"},
			{"name": "archive.zip"},
		},
	})
	if err := service.SubmitToolResults(session.ID, "user-1", []ToolResult{{
		RequestID: events[1].ToolRequests[0].ID,
		Name:      ToolListDirectory,
		OK:        true,
		Result:    result,
	}}); err != nil {
		t.Fatalf("SubmitToolResults() error = %v", err)
	}

	events, err = service.Events(session.ID, "user-1", 2)
	if err != nil {
		t.Fatalf("Events(after) error = %v", err)
	}
	if len(events) != 2 {
		t.Fatalf("follow-up events len = %d, want 2: %#v", len(events), events)
	}
	if events[1].Type != EventFilePlan || events[1].FilePlan == nil {
		t.Fatalf("expected file plan event, got %#v", events[1])
	}
	if len(events[1].FilePlan.Operations) < 4 {
		t.Fatalf("file plan operations = %#v, want mkdirs and moves", events[1].FilePlan.Operations)
	}
}

func TestAgentSessionOwnership(t *testing.T) {
	service := NewService(NewSessionStore(0), MockProvider{})
	session := service.CreateSession("user-1")
	if err := service.SendMessage(session.ID, "user-2", AgentMessageRequest{UserMessage: "hello"}); err != ErrSessionNotFound {
		t.Fatalf("SendMessage() error = %v, want ErrSessionNotFound", err)
	}
}

func TestSessionStoreTTLCleanup(t *testing.T) {
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	store := NewSessionStore(time.Minute)
	store.now = func() time.Time { return now }

	session := store.Create("user-1")
	now = now.Add(2 * time.Minute)
	_ = store.Create("user-1")

	if _, err := store.Events(session.ID, "user-1", 0); err != ErrSessionNotFound {
		t.Fatalf("Events() error = %v, want ErrSessionNotFound after TTL cleanup", err)
	}
}
