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

	"golang.org/x/oauth2"
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
	schema := agentResponseJSONSchema()
	properties := schema["properties"].(map[string]any)
	filePlan := properties["file_plan"].(map[string]any)
	if filePlan["type"] != "object" {
		t.Fatalf("file_plan schema type = %#v", filePlan["type"])
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
		generation, _ := body["generation_config"].(map[string]any)
		if generation["max_output_tokens"] != float64(MaxModelOutputTokens) {
			t.Fatalf("generation_config = %#v", generation)
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

func TestNewMikaProviderFromEnvUsesPerTierRoutes(t *testing.T) {
	t.Setenv("AI_GATEWAY_API_KEY", "gateway-key")
	t.Setenv("OPENAI_API_KEY", "openai-key-that-must-not-be-used")
	t.Setenv("MISTY_AI_LOW_MODEL", "google/gemini-low")
	t.Setenv("MISTY_AI_MED_MODEL", "anthropic/claude-med")
	t.Setenv("MISTY_AI_HIGH_MODEL", "openai/gpt-high")

	router, ok := NewMikaProviderFromEnv().(*MikaProviderRouter)
	if !ok {
		t.Fatalf("NewMikaProviderFromEnv() did not return a Mika router")
	}
	if provider, model := providerStatus(router.ProviderForTier(MikaLow)); provider != ProviderVercelAI || model != "google/gemini-low" {
		t.Fatalf("low route = %s/%s", provider, model)
	}
	if provider, model := providerStatus(router.ProviderForTier(MikaMed)); provider != ProviderVercelAI || model != "anthropic/claude-med" {
		t.Fatalf("med route = %s/%s", provider, model)
	}
	if provider, model := providerStatus(router.ProviderForTier(MikaHigh)); provider != ProviderVercelAI || model != "openai/gpt-high" {
		t.Fatalf("high route = %s/%s", provider, model)
	}
	lowProvider, ok := router.ProviderForTier(MikaLow).(*OpenAIProvider)
	if !ok || lowProvider.apiKey != "gateway-key" || lowProvider.baseURL != defaultVercelAIBaseURL {
		t.Fatalf("low gateway provider = %#v", lowProvider)
	}
}

func TestNewMikaProviderFromEnvUsesGatewayDefaultsAndRequiresGatewayAuth(t *testing.T) {
	t.Setenv("AI_GATEWAY_API_KEY", "gateway-key")
	router := NewMikaProviderFromEnv().(*MikaProviderRouter)
	if _, model := providerStatus(router.ProviderForTier(MikaLow)); model != defaultMikaLowGatewayModel {
		t.Fatalf("low default model = %q", model)
	}
	if _, model := providerStatus(router.ProviderForTier(MikaMed)); model != defaultMikaMedGatewayModel {
		t.Fatalf("med default model = %q", model)
	}
	if _, model := providerStatus(router.ProviderForTier(MikaHigh)); model != defaultMikaHighGatewayModel {
		t.Fatalf("high default model = %q", model)
	}

	t.Setenv("AI_GATEWAY_API_KEY", "")
	t.Setenv("VERCEL_OIDC_TOKEN", "")
	t.Setenv("OPENAI_API_KEY", "direct-provider-key")
	router = NewMikaProviderFromEnv().(*MikaProviderRouter)
	if provider, _ := providerStatus(router.ProviderForTier(MikaHigh)); provider != ProviderMock {
		t.Fatalf("Mika bypassed gateway with provider %q", provider)
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

func TestProviderUsageParsing(t *testing.T) {
	openAI := extractOpenAIUsage([]byte(`{"usage":{"input_tokens":120,"output_tokens":40,"input_tokens_details":{"cached_tokens":20},"output_tokens_details":{"reasoning_tokens":10}}}`))
	if openAI.InputTokens != 120 || openAI.CachedInputTokens != 20 || openAI.OutputTokens != 40 || openAI.ReasoningTokens != 10 {
		t.Fatalf("OpenAI usage = %#v", openAI)
	}
	gemini := extractGeminiUsage([]byte(`{"usageMetadata":{"promptTokenCount":90,"cachedContentTokenCount":10,"candidatesTokenCount":30,"thoughtsTokenCount":5}}`))
	if gemini.InputTokens != 90 || gemini.CachedInputTokens != 10 || gemini.OutputTokens != 35 || gemini.ReasoningTokens != 5 {
		t.Fatalf("Gemini usage = %#v", gemini)
	}
	interaction := extractGeminiUsage([]byte(`{"usage":{"total_input_tokens":100,"total_cached_tokens":20,"total_output_tokens":40,"total_thought_tokens":8}}`))
	if interaction.InputTokens != 100 || interaction.CachedInputTokens != 20 || interaction.OutputTokens != 48 || interaction.ReasoningTokens != 8 {
		t.Fatalf("Gemini interaction usage = %#v", interaction)
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
