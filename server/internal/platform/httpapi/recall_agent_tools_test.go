package api

import (
	"context"
	"testing"

	serveragent "github.com/kannachi323/misty/server/internal/agents"
	"github.com/kannachi323/misty/server/internal/agenttools"
)

func TestRecallToolsAreOfferedOnlyWithMemoryAndGateThemselves(t *testing.T) {
	t.Setenv("MISTY_RECALL", "")
	service := &SpacesService{}
	if len(service.recallToolRegistrations()) != 0 {
		t.Fatal("recall tools offered while Memory is off")
	}
	t.Setenv("MISTY_RECALL", "true")
	registrations := service.recallToolRegistrations()
	if len(registrations) != 3 {
		t.Fatalf("recall tools = %d", len(registrations))
	}
	for _, registration := range registrations {
		// They ask through grants, not the generic Ask pause.
		if gatedByAsk(registration.Descriptor) {
			t.Fatalf("%s goes through the generic gate", registration.Descriptor.Name)
		}
	}
	forget := registrations[2]
	if forget.Descriptor.Name != recallForgetTool || forget.Descriptor.Risk != serveragent.RiskWrite {
		t.Fatalf("forget = %+v", forget.Descriptor)
	}
	// Forgetting everything is for Settings, never an agent.
	if _, err := forget.Handler(context.Background(), agenttools.Invocation{UserID: "u"}, serveragent.ToolRequest{Name: recallForgetTool, Arguments: []byte(`{}`)}); err == nil {
		t.Fatal("forget without a site or range was accepted")
	}
}
