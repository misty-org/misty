package api

import (
	"encoding/json"
	"strings"
	"testing"

	db "github.com/kannachi323/misty/server/internal/platform/postgres"
)

func screenRecord(t *testing.T, body map[string]any) *db.AIInvocationRecord {
	t.Helper()
	payload, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	return &db.AIInvocationRecord{ID: "aiinv_fixture", UserID: "owner", RequestPayload: payload}
}

func TestScreenToolsAreOfferedOnlyToDesktopAgentRuns(t *testing.T) {
	s := &SpacesService{}
	for name, body := range map[string]map[string]any{
		"web":       {"agent_id": "misty"},
		"no agent":  {"window_label": "main"},
		"malformed": nil,
	} {
		if got := s.screenToolRegistrations(screenRecord(t, body)); len(got) != 0 {
			t.Fatalf("%s run got screen tools: %d", name, len(got))
		}
	}
	got := s.screenToolRegistrations(screenRecord(t, map[string]any{"agent_id": "misty", "window_label": "main"}))
	names := []string{}
	for _, registration := range got {
		names = append(names, registration.Descriptor.Name)
		if registration.Descriptor.Risk != "read" || registration.Handler == nil {
			t.Fatalf("%s must be a read with a handler", registration.Descriptor.Name)
		}
	}
	if strings.Join(names, ",") != "screen.open,screen.look" {
		t.Fatalf("screen tools = %v", names)
	}
}

func TestScreenGuidanceOffersOnDemandScreensInsteadOfAModeChoice(t *testing.T) {
	desktop := agentCapabilityGuidance([]string{"spaces.list", "screen.open", "screen.look"}, false)
	if !strings.Contains(desktop, "call screen_open") || !strings.Contains(desktop, "call screen_look") {
		t.Fatal(desktop)
	}
	attached := agentCapabilityGuidance([]string{"screen.open", "screen.look", "browser.inspect"}, false)
	if strings.Contains(attached, "screen_open") || !strings.Contains(attached, "screen_look") {
		t.Fatal(attached)
	}
	for _, guidance := range []string{desktop, attached, agentCapabilityGuidance([]string{"spaces.list"}, false)} {
		if strings.Contains(guidance, "above the composer") || strings.Contains(guidance, "Separate Misty window") {
			t.Fatal("guidance still asks the user to pick a mode")
		}
	}
}
