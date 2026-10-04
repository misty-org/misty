package api

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/kannachi323/misty/server/internal/capabilities"
)

func TestBrowserRegistryInteractionContract(t *testing.T) {
	var found bool
	for _, tool := range browserToolDescriptors() {
		if tool.Name != "browser.interact" {
			continue
		}
		found = true
		schema, err := capabilities.CompileSchema(tool.InputSchema)
		if err != nil {
			t.Fatal(err)
		}
		var valid any
		_ = json.Unmarshal([]byte(`{"scopeId":"scope-browser","documentId":"2d9dd46a-90b5-40b3-a72b-b7fb87c57c0d","action":{"kind":"scroll","x":0,"y":400}}`), &valid)
		if err := schema.Validate(valid); err != nil {
			t.Fatal(err)
		}
		delete(valid.(map[string]any), "documentId")
		if schema.Validate(valid) == nil {
			t.Fatal("missing fresh document accepted")
		}
	}
	if !found {
		t.Fatal("browser interaction absent from registry")
	}
}

func TestRunCatalogRetainsGrantedBrowserTools(t *testing.T) {
	toolbox := buildAgentToolbox(nil, agentToolboxOptions{
		accountLevel: true, browserTabs: []string{"Browser (scopeId scope-browser)"},
		browserCapabilities: map[string]bool{"browser.inspect": true, "browser.click": true, "browser.interact": true},
	})
	granted := 0
	for _, descriptor := range toolbox.Descriptors() {
		if !strings.HasPrefix(descriptor.Name, "browser.") {
			continue
		}
		granted++
		if descriptor.Approval != "none" || !strings.Contains(descriptor.Description, "scope-browser") {
			t.Fatalf("unexpected browser descriptor: %+v", descriptor)
		}
	}
	if granted != 3 {
		t.Fatalf("granted browser tools lost from the catalog: %d", granted)
	}
}
