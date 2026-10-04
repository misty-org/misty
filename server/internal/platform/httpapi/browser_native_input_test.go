package api

import (
	"encoding/json"
	"github.com/kannachi323/misty/server/internal/capabilities"
	"testing"
)

func TestNativeBrowserInputBoundary(t *testing.T) {
	schema, err := capabilities.CompileSchema(browserAgentToolSchema("interact"))
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	_ = json.Unmarshal([]byte(`{"scopeId":"browser-scope","documentId":"2d9dd46a-90b5-40b3-a72b-b7fb87c57c0d","consequential":false,"description":"Draw the house wall on the canvas","action":{"kind":"native","input":{"kind":"drag","fromX":0.2,"fromY":0.2,"toX":0.8,"toY":0.8}}}`), &value)
	if err = schema.Validate(value); err != nil {
		t.Fatal(err)
	}
	delete(value, "consequential")
	if schema.Validate(value) == nil {
		t.Fatal("native action without consequence classification accepted")
	}
	value["consequential"] = false
	value["action"].(map[string]any)["input"].(map[string]any)["toX"] = 1.5
	if schema.Validate(value) == nil {
		t.Fatal("native drag outside browser accepted")
	}
	body := aiInvocationInput{AgentID: "agent", ExecutionMode: "team"}
	if !nativeRoutineBrowserAction(body, "browser.interact", json.RawMessage(`{"consequential":false,"description":"Draw a wall on the canvas","action":{"kind":"native","input":{"kind":"drag"}}}`), "") {
		t.Fatal("routine canvas drag requires review")
	}
	for _, raw := range []string{
		`{"description":"Draw a wall","action":{"kind":"native","input":{"kind":"drag"}}}`,
		`{"consequential":true,"description":"Draw a wall","action":{"kind":"native","input":{"kind":"drag"}}}`,
		`{"consequential":false,"description":"Delete the workspace","action":{"kind":"native","input":{"kind":"click"}}}`,
		`{"consequential":false,"description":"Finish the form","action":{"kind":"native","input":{"kind":"key","key":"Enter"}}}`,
	} {
		if nativeRoutineBrowserAction(body, "browser.interact", json.RawMessage(raw), "") {
			t.Fatal("consequential native action skipped review")
		}
	}
}
