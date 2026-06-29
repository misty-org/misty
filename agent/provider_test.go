package agent

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"golang.org/x/oauth2"
)

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
					"text": `{"text":"I will inspect the folder.","tool_requests":[{"name":"list_directory","risk":"read","arguments":{"path":"Desktop"}}],"file_plan":null}`,
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
}

func TestGeminiProviderUsesInteractionsStructuredOutput(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/interactions" {
			t.Fatalf("path = %q, want /interactions", r.URL.Path)
		}
		if got := r.Header.Get("X-Goog-Api-Key"); got != "test-key" {
			t.Fatalf("X-Goog-Api-Key = %q", got)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("request JSON error = %v", err)
		}
		if body["model"] != "gemini-test" {
			t.Fatalf("model = %v, want gemini-test", body["model"])
		}
		if _, ok := body["max_output_tokens"]; ok {
			t.Fatalf("Gemini request included OpenAI-only max_output_tokens: %#v", body)
		}
		format, _ := body["response_format"].(map[string]any)
		if format["mime_type"] != "application/json" {
			t.Fatalf("response_format = %#v", format)
		}
		if _, ok := format["schema"].(map[string]any); !ok {
			t.Fatalf("missing response schema: %#v", format)
		}
		writeJSONResponse(t, w, map[string]any{
			"output_text": `{"text":"Plan ready.","tool_requests":[],"file_plan":{"summary":"I will make a docs folder.","completion_summary":"Created the docs folder.","operations":[{"type":"mkdir","path":"Documents","reason":"Group docs."}],"warnings":[]}}`,
		})
	}))
	defer server.Close()

	provider := NewGeminiProvider(GeminiProviderConfig{
		APIKey:  "test-key",
		BaseURL: server.URL,
		Model:   "gemini-test",
		Client:  server.Client(),
	})
	response, err := provider.Next(ModelRequest{
		SessionID:  "s",
		UserID:     "u",
		Mode:       ModeAuto,
		ActiveRoot: "Desktop",
		Messages:   []Message{{Role: "user", Content: "Organize this"}},
	})
	if err != nil {
		t.Fatalf("Next() error = %v", err)
	}
	if response.FilePlan == nil || !strings.Contains(response.FilePlan.Summary, "docs") {
		t.Fatalf("FilePlan = %#v", response.FilePlan)
	}
	if !strings.Contains(response.FilePlan.CompletionSummary, "Created") {
		t.Fatalf("CompletionSummary = %q", response.FilePlan.CompletionSummary)
	}
	if len(response.FilePlan.Operations) != 1 || response.FilePlan.Operations[0].Type != "mkdir" {
		t.Fatalf("Operations = %#v", response.FilePlan.Operations)
	}
}

func TestGeminiProviderUsesADCTokenSourceWithoutAPIKey(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer adc-token" {
			t.Fatalf("Authorization = %q", got)
		}
		if got := r.Header.Get("X-Goog-Api-Key"); got != "" {
			t.Fatalf("X-Goog-Api-Key = %q", got)
		}
		writeJSONResponse(t, w, map[string]any{
			"output_text": `{"text":"Ready.","tool_requests":[],"file_plan":null}`,
		})
	}))
	defer server.Close()

	provider := NewGeminiProvider(GeminiProviderConfig{
		BaseURL: server.URL,
		Model:   "gemini-test",
		TokenSource: staticTokenSource{
			token: &oauth2.Token{AccessToken: "adc-token", TokenType: "Bearer"},
		},
		Client: server.Client(),
	})
	response, err := provider.Next(ModelRequest{
		SessionID: "s",
		UserID:    "u",
		Mode:      ModeAuto,
		Messages:  []Message{{Role: "user", Content: "Organize this"}},
	})
	if err != nil {
		t.Fatalf("Next() error = %v", err)
	}
	if response.Text != "Ready." {
		t.Fatalf("Text = %q", response.Text)
	}
}

func TestGeminiProviderADCPrefersTokenOverAPIKey(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer adc-token" {
			t.Fatalf("Authorization = %q", got)
		}
		if got := r.Header.Get("X-Goog-Api-Key"); got != "" {
			t.Fatalf("X-Goog-Api-Key = %q", got)
		}
		writeJSONResponse(t, w, map[string]any{
			"output_text": `{"text":"Ready.","tool_requests":[],"file_plan":null}`,
		})
	}))
	defer server.Close()

	provider := NewGeminiProvider(GeminiProviderConfig{
		APIKey:   "api-key",
		AuthMode: "adc",
		BaseURL:  server.URL,
		Model:    "gemini-test",
		TokenSource: staticTokenSource{token: &oauth2.Token{
			AccessToken: "adc-token",
			TokenType:   "Bearer",
		}},
		Client: server.Client(),
	})
	if _, err := provider.Next(ModelRequest{
		SessionID: "s",
		UserID:    "u",
		Mode:      ModeAuto,
		Messages:  []Message{{Role: "user", Content: "Organize this"}},
	}); err != nil {
		t.Fatalf("Next() error = %v", err)
	}
}

func TestNewProviderFromEnvSelectsConfiguredProvider(t *testing.T) {
	t.Setenv("MISTY_AI_PROVIDER", "gemini")
	t.Setenv("GEMINI_API_KEY", "key")
	t.Setenv("MISTY_AI_MODEL", "gemini-test")

	if _, ok := NewProviderFromEnv().(*ADKGeminiProvider); !ok {
		t.Fatalf("NewProviderFromEnv() did not select ADK Gemini provider")
	}

	t.Setenv("MISTY_AI_PROVIDER", "openai")
	t.Setenv("OPENAI_API_KEY", "key")
	if _, ok := NewProviderFromEnv().(*OpenAIProvider); !ok {
		t.Fatalf("NewProviderFromEnv() did not select OpenAI provider")
	}
}

func TestParseFirstProviderJSONResponseUsesConcatenatedCandidate(t *testing.T) {
	response, err := parseFirstProviderJSONResponse([]string{
		`{"text":"I will inspect`,
		`{"text":"I will inspect the folder.","tool_requests":[],"file_plan":null}`,
	})
	if err != nil {
		t.Fatalf("parseFirstProviderJSONResponse() error = %v", err)
	}
	if response.Text != "I will inspect the folder." {
		t.Fatalf("Text = %q", response.Text)
	}
}

func TestParseFirstProviderJSONResponseExtractsWrappedJSON(t *testing.T) {
	response, err := parseFirstProviderJSONResponse([]string{
		`Here is the plan: {"text":"Plan ready.","tool_requests":[],"file_plan":null}`,
	})
	if err != nil {
		t.Fatalf("parseFirstProviderJSONResponse() error = %v", err)
	}
	if response.Text != "Plan ready." {
		t.Fatalf("Text = %q", response.Text)
	}
}

func TestNewProviderFromEnvSelectsGeminiRESTFallback(t *testing.T) {
	t.Setenv("MISTY_AI_PROVIDER", "gemini_rest")
	t.Setenv("GEMINI_API_KEY", "key")
	t.Setenv("MISTY_AI_MODEL", "gemini-test")

	if provider, ok := NewProviderFromEnv().(*GeminiProvider); !ok {
		t.Fatalf("NewProviderFromEnv() = %T, want *GeminiProvider", provider)
	}
}

func TestNewProviderFromEnvAcceptsGoogleAPIKeyForADKGemini(t *testing.T) {
	t.Setenv("MISTY_AI_PROVIDER", "gemini")
	t.Setenv("GEMINI_AUTH_MODE", "api_key")
	t.Setenv("GOOGLE_API_KEY", "key")
	t.Setenv("MISTY_AI_MODEL", "gemini-test")

	if provider, ok := NewProviderFromEnv().(*ADKGeminiProvider); !ok {
		t.Fatalf("NewProviderFromEnv() = %T, want *ADKGeminiProvider", provider)
	}
}

func TestNewProviderFromEnvSelectsGeminiForADC(t *testing.T) {
	t.Setenv("MISTY_AI_PROVIDER", "gemini")
	t.Setenv("GEMINI_AUTH_MODE", "adc")

	if _, ok := NewProviderFromEnv().(*ADKGeminiProvider); !ok {
		t.Fatalf("NewProviderFromEnv() did not select ADK Gemini provider")
	}
}

type staticTokenSource struct {
	token *oauth2.Token
	err   error
}

func (s staticTokenSource) Token() (*oauth2.Token, error) {
	return s.token, s.err
}

func writeJSONResponse(t *testing.T, w http.ResponseWriter, value any) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(value); err != nil {
		t.Fatalf("response JSON error = %v", err)
	}
}
