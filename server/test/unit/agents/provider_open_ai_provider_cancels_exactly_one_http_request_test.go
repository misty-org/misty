package agent

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	. "github.com/kannachi323/misty/server/internal/agents"
)

func TestOpenAIProviderCancelsExactlyOneHTTPRequest(t *testing.T) {
	started := make(chan struct{})
	releaseServer := make(chan struct{})
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		close(started)
		<-releaseServer
	}))
	defer func() {
		close(releaseServer)
		server.Close()
	}()
	provider := NewOpenAIProvider(OpenAIProviderConfig{APIKey: "test-key", BaseURL: server.URL, Model: "test", Client: server.Client()})
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := provider.NextContext(ctx, ModelRequest{SessionID: "s", UserID: "u", Messages: []Message{{Role: "user", Content: "wait"}}})
		done <- err
	}()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("gateway request did not start")
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("NextContext() error = %v, want context.Canceled", err)
		}
	case <-time.After(time.Second):
		t.Fatal("gateway request was not canceled")
	}
	if got := requests.Load(); got != 1 {
		t.Fatalf("HTTP requests = %d, want exactly 1 with no retry", got)
	}
}

func TestOpenAIProviderNeverFollowsRedirectsOrResends(t *testing.T) {
	var initialRequests atomic.Int32
	var redirectedRequests atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		redirectedRequests.Add(1)
	}))
	defer target.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		initialRequests.Add(1)
		http.Redirect(w, &http.Request{}, target.URL, http.StatusTemporaryRedirect)
	}))
	defer server.Close()
	provider := NewOpenAIProvider(OpenAIProviderConfig{APIKey: "test-key", BaseURL: server.URL, Model: "test", Client: server.Client()})
	if _, err := provider.Next(ModelRequest{SessionID: "s", UserID: "u", Messages: []Message{{Role: "user", Content: "once"}}}); err == nil || !strings.Contains(err.Error(), "status 307") {
		t.Fatalf("Next() error = %v, want terminal 307", err)
	}
	if initialRequests.Load() != 1 || redirectedRequests.Load() != 0 {
		t.Fatalf("initial requests=%d redirected requests=%d, want 1 and 0", initialRequests.Load(), redirectedRequests.Load())
	}
}

func TestOpenAIProviderUsesResponsesStructuredOutput(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/responses" {
			t.Fatalf("path = %q, want /responses", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-key" {
			t.Fatalf("Authorization = %q", got)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("request JSON error = %v", err)
		}
		if body["model"] != "gpt-test" {
			t.Fatalf("model = %v, want gpt-test", body["model"])
		}
		text, _ := body["text"].(map[string]any)
		format, _ := text["format"].(map[string]any)
		if format["type"] != "json_schema" || format["name"] != "misty_agent_response" {
			t.Fatalf("format = %#v", format)
		}
		writeJSONResponse(t, w, map[string]any{
			"output": []map[string]any{{
				"content": []map[string]any{{
					"type": "output_text",
					"text": `{"text":"I will inspect the folder.","tool_requests":[{"name":"list_directory","risk":"read","arguments":{"path":"Desktop"}}],"file_plan":{"summary":"","completion_summary":"","operations":[],"warnings":[]}}`,
				}},
			}},
		})
	}))
	defer server.Close()

	provider := NewOpenAIProvider(OpenAIProviderConfig{
		APIKey:  "test-key",
		BaseURL: server.URL,
		Model:   "gpt-test",
		Client:  server.Client(),
	})
	response, err := provider.Next(ModelRequest{
		SessionID:  "s",
		UserID:     "u",
		Mode:       ModeAuto,
		ActiveRoot: "Desktop",
		Messages:   []Message{{Role: "user", Content: "Organize this"}},
		KnownPaths: []string{"invoice.pdf"},
		Capabilities: ToolManifest{Tools: []ToolDefinition{
			{Name: ToolListDirectory, Risk: RiskRead},
		}},
	})
	if err != nil {
		t.Fatalf("Next() error = %v", err)
	}
	if response.Text != "I will inspect the folder." {
		t.Fatalf("Text = %q", response.Text)
	}
	if len(response.ToolRequests) != 1 || response.ToolRequests[0].Name != ToolListDirectory {
		t.Fatalf("ToolRequests = %#v", response.ToolRequests)
	}
	if response.ToolRequests[0].ID == "" {
		t.Fatalf("ToolRequest ID was not normalized: %#v", response.ToolRequests[0])
	}
	if response.FilePlan != nil {
		t.Fatalf("empty wire file plan was not normalized: %#v", response.FilePlan)
	}
}

func TestGatewayAgentSchemaUsesPortableNonNullableFilePlan(t *testing.T) {
	schema := TestingAgentResponseJSONSchema()
	properties := schema["properties"].(map[string]any)
	filePlan := properties["file_plan"].(map[string]any)
	if filePlan["type"] != "object" {
		t.Fatalf("file_plan schema type = %#v", filePlan["type"])
	}
}
