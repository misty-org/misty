package agent

import "testing"

func TestVoiceConversationBrowserRoutingSchema(t *testing.T) {
	config := VoiceConversationConfig("[]")["config"].(map[string]any)
	foundStart := false
	for _, tool := range config["tools"].([]map[string]any) {
		parameters := tool["parameters"].(map[string]any)
		properties := parameters["properties"].(map[string]any)
		if tool["name"] != "start_task" {
			if _, exists := properties["needs_browser"]; exists {
				t.Fatalf("browser routing exposed on %s", tool["name"])
			}
			continue
		}
		foundStart = true
		for _, field := range []string{"needs_browser", "needs_screen"} {
			schema, ok := properties[field].(map[string]string)
			if !ok || schema["type"] != "boolean" || schema["description"] == "" {
				t.Fatalf("missing structured routing flag %s: %+v", field, properties[field])
			}
		}
		if parameters["additionalProperties"] != false {
			t.Fatal("task arguments must remain closed")
		}
	}
	if !foundStart {
		t.Fatal("missing start_task")
	}
}
