package api

import (
	"context"
	"encoding/json"
	"strings"

	serveragent "github.com/kannachi323/misty/server/internal/agents"
	"github.com/kannachi323/misty/server/internal/agenttools"
	db "github.com/kannachi323/misty/server/internal/platform/postgres"
)

// Screens open on demand. A run started on the desktop can ask for one with
// screen.open, or see the user's screen with screen.look. Either ends the run
// with a screen request; the desktop opens the screen where the account
// setting says and continues the same conversation with it attached, through
// the same lease and admission checks as any other screen task.
const (
	screenOpenTool = "screen.open"
	screenLookTool = "screen.look"
)

// screenRequest is what the desktop needs to open a screen and continue.
type screenRequest struct {
	Kind     string `json:"kind"`
	URL      string `json:"url,omitempty"`
	Reason   string `json:"reason"`
	Location string `json:"location"`
}

// screenToolRegistrations are offered to desktop runs only; other surfaces
// have no screen to open.
func (s *SpacesService) screenToolRegistrations(record *db.AIInvocationRecord) []agenttools.Registration {
	var body aiInvocationInput
	if record == nil || json.Unmarshal(record.RequestPayload, &body) != nil || body.WindowLabel == "" || body.AgentID == "" {
		return nil
	}
	reason := map[string]any{"type": "string", "minLength": 3, "maxLength": 300, "description": "What the screen is for, in a few words the user will see"}
	return []agenttools.Registration{
		{Descriptor: screenDescriptor(screenOpenTool,
			"Open a browser screen for this task when it needs a website or web app that no connected app or Misty tool covers. "+
				"If a browser is already attached, use the browser tools with its scopeId instead. Otherwise this ends the current "+
				"response; Misty opens the screen where the user prefers and continues this conversation with the browser attached. "+
				"Do not ask the user where to work.",
			map[string]any{"reason": reason, "url": map[string]any{"type": "string", "maxLength": 2048, "description": "Optional https page to open first"}}, "reason"),
			Handler: s.screenRequestHandler(screenOpenTool)},
		{Descriptor: screenDescriptor(screenLookTool,
			"See what is on the user's screen right now, when the request refers to something visible there. "+
				"Ends the current response; Misty captures the screen and continues this conversation with the image attached.",
			map[string]any{"reason": reason}, "reason"),
			Handler: s.screenRequestHandler(screenLookTool)},
	}
}

func screenDescriptor(name, description string, properties map[string]any, required ...string) agenttools.Descriptor {
	return agenttools.Descriptor{
		Name: name, Version: 1, Description: description, Risk: serveragent.RiskRead,
		InputSchema:  TestingMustAPIRawJSON(map[string]any{"type": "object", "properties": properties, "required": required, "additionalProperties": false}),
		OutputSchema: agentToolObjectOutputSchema(), Approval: agenttools.ApprovalNone, Locality: agenttools.LocalityServer,
		Idempotent: true, AllowCustomAgent: true, AuditEvent: name,
	}
}

func (s *SpacesService) screenRequestHandler(tool string) agenttools.Handler {
	return func(ctx context.Context, invocation agenttools.Invocation, request serveragent.ToolRequest) (json.RawMessage, error) {
		var input struct {
			Reason string `json:"reason"`
			URL    string `json:"url"`
		}
		if json.Unmarshal(request.Arguments, &input) != nil || strings.TrimSpace(input.Reason) == "" {
			return nil, serveragent.ErrInvalidRequest("Describe what the screen is for.")
		}
		if input.URL != "" && !strings.HasPrefix(input.URL, "https://") && !strings.HasPrefix(input.URL, "http://") {
			return nil, serveragent.ErrInvalidRequest("url must be an http or https address.")
		}
		record, err := s.database.AIInvocationByID(ctx, invocation.UserID, invocation.RunID)
		if err != nil {
			return nil, err
		}
		var body aiInvocationInput
		if json.Unmarshal(record.RequestPayload, &body) != nil {
			return nil, db.ErrSpaceInvalid
		}
		if tool == screenOpenTool {
			if screens, _ := aiInvocationBrowserGrants(ctx, s.database, invocation.UserID, invocation.RunID); len(screens) > 0 {
				return json.Marshal(map[string]any{"status": "open", "screens": screens,
					"message": "A browser is already attached to this task. Use the browser tools with its scopeId."})
			}
		} else if len(body.DisplayCaptures) > 0 || body.Capture != nil {
			return json.Marshal(map[string]any{"status": "open",
				"message": "The user's screen is already attached to this request. Read it from the attached image."})
		}
		settings, _, err := s.database.AISettings(ctx, invocation.UserID)
		if err != nil {
			return nil, err
		}
		screen := &screenRequest{Kind: strings.TrimPrefix(tool, "screen."), URL: input.URL, Reason: strings.TrimSpace(input.Reason), Location: settings.ScreenLocation}
		if s.aiInvocations != nil {
			if _, err := s.aiInvocations.restoreDurable(ctx, *record); err != nil {
				return nil, err
			}
			if err := s.aiInvocations.append(record.ID, aiInvocationEvent{Type: "screen.request", ScreenRequest: screen}); err != nil {
				return nil, err
			}
		}
		return json.Marshal(map[string]any{"status": "screen_requested", "kind": screen.Kind,
			"message": "Misty is opening the screen and will continue this conversation with it attached."})
	}
}
