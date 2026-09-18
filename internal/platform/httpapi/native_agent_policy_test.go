package api

import (
	serveragent "github.com/kannachi323/misty/server/internal/agents"
	"testing"
)

func TestNativeAgentModesAndAssignmentsAreIndependentOfPlanning(t *testing.T) {
	cases := []struct {
		name, risk, mode string
		apps             map[string]bool
		allowed          bool
	}{
		{"tasks.list", serveragent.RiskRead, "user", map[string]bool{"planner": true}, true},
		{"tasks.create", serveragent.RiskWrite, "user", map[string]bool{"planner": true}, false},
		{"tasks.create", serveragent.RiskWrite, "agent", map[string]bool{"planner": true}, true},
		{"tasks.create", serveragent.RiskWrite, "team", map[string]bool{}, false},
		{"notes.get", serveragent.RiskRead, "team", map[string]bool{"planner": true}, false},
		{"agents.configure", serveragent.RiskWrite, "user", nil, true},
		{"agents.configure", serveragent.RiskWrite, "agent", map[string]bool{"planner": true}, false},
		{"agents.configure", serveragent.RiskWrite, "team", nil, false},
		{"agents.list", serveragent.RiskRead, "team", nil, true},
		{"memory.remember", serveragent.RiskWrite, "user", nil, true},
		{"browser.upload", serveragent.RiskWrite, "user", nil, false},
		{"ask.delegate", serveragent.RiskWrite, "team", nil, false},
		{"mcp.call", serveragent.RiskRead, "agent", nil, true},
		{"mcp.call", serveragent.RiskRead, "user", nil, true},
		{"mcp.mutate", serveragent.RiskWrite, "user", nil, false},
		{"mcp.mutate", serveragent.RiskWrite, "agent", nil, true},
		{"unknown.execute", serveragent.RiskWrite, "agent", nil, false},
	}
	for _, c := range cases {
		t.Run(c.name+"/"+c.mode, func(t *testing.T) {
			if actual := nativeAgentToolAllowed(c.name, c.risk, c.mode, c.apps); actual != c.allowed {
				t.Fatalf("allowed=%v; want %v", actual, c.allowed)
			}
		})
	}
}
func TestNativeAgentContextCannotBroadenAssignments(t *testing.T) {
	refs := []aiContextReference{
		{Kind: "space", ID: "space", Metadata: map[string]any{"unscoped": "content"}},
		{Kind: "note", ID: "private-journal"}, {Kind: "task", ID: "assigned-planner"},
		{Kind: "workspace.scope", ID: "all"},
		{Kind: "browser-tab", ID: "notion", Metadata: map[string]any{"app_id": "planner"}},
		{Kind: "browser-tab", ID: "instagram", Metadata: map[string]any{"app_id": "chat"}},
	}
	filtered := filterNativeAgentContext(refs, []string{"planner"})
	if len(filtered) != 3 || filtered[0].Metadata != nil || filtered[1].ID != "assigned-planner" || filtered[2].ID != "notion" {
		t.Fatalf("unexpected context: %+v", filtered)
	}
}
