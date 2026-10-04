package api

import (
	"encoding/json"
	"strings"
	"time"

	db "github.com/kannachi323/misty/server/internal/platform/postgres"
)

type browserApprovalReview struct {
	Kind         string                   `json:"kind"`
	RunID        string                   `json:"runId"`
	EffectID     string                   `json:"effectId"`
	CallID       string                   `json:"callId"`
	Operation    string                   `json:"operation"`
	Input        json.RawMessage          `json:"input"`
	Target       db.BrowserApprovalTarget `json:"target"`
	PageURL      string                   `json:"pageUrl"`
	PageTitle    string                   `json:"pageTitle"`
	ElementLabel string                   `json:"elementLabel"`
	Deadline     time.Time                `json:"deadline"`
}

type browserApprovalRequired struct{ approval *db.AgentToolApproval }

func (e *browserApprovalRequired) Error() string { return "browser_approval_required" }

func nativeRoutineBrowserAction(body aiInvocationInput, name string, arguments json.RawMessage, label string) bool {
	if body.AgentID == "" || (body.ExecutionMode != "agent" && body.ExecutionMode != "team") {
		return false
	}
	var input struct {
		Consequential *bool  `json:"consequential"`
		Description   string `json:"description"`
		Action        struct {
			Kind  string `json:"kind"`
			Key   string `json:"key"`
			Input struct {
				Kind string `json:"kind"`
				Key  string `json:"key"`
			} `json:"input"`
		} `json:"action"`
	}
	if json.Unmarshal(arguments, &input) != nil {
		return false
	}
	if input.Consequential != nil && *input.Consequential {
		return false
	}
	if name == "browser.workspace.interact" {
		return body.ExecutionMode == "agent" && body.WindowLabel == "main" && input.Consequential != nil && !*input.Consequential && !(input.Action.Kind == "key" && input.Action.Key == "Enter")
	}
	if name == "browser.interact" {
		if input.Action.Kind == "native" {
			if input.Consequential == nil || *input.Consequential || strings.TrimSpace(input.Description) == "" {
				return false
			}
			switch input.Action.Input.Kind {
			case "click", "drag", "type", "scroll":
			case "key":
				if input.Action.Input.Key == "Enter" {
					return false
				}
			default:
				return false
			}
			return routineBrowserLabel(input.Description)
		}
		switch input.Action.Kind {
		case "fill", "select", "scroll":
			return true
		case "key":
			return input.Action.Key != "Enter"
		}
	}
	if name != "browser.click" || input.Consequential == nil || *input.Consequential {
		return false
	}
	return routineBrowserLabel(label)
}

func routineBrowserLabel(label string) bool {
	if strings.TrimSpace(label) == "" {
		return false
	}
	value := strings.ToLower(label)
	for _, term := range []string{"send", "publish", "post", "delete", "remove", "pay", "purchase", "buy", "order", "subscribe", "confirm", "transfer", "invite", "share", "submit", "authorize", "accept", "agree"} {
		if strings.Contains(value, term) {
			return false
		}
	}
	return true
}
