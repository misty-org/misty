package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestScreenModelForwardsWithTheRunModelAndServerKey(t *testing.T) {
	var got map[string]any
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" || r.Header.Get("Authorization") != "Bearer gateway-key" {
			t.Errorf("unexpected request %s %q", r.URL.Path, r.Header.Get("Authorization"))
		}
		_ = json.NewDecoder(r.Body).Decode(&got)
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ok"}}],"usage":{"prompt_tokens":120,"completion_tokens":30}}`))
	}))
	defer gateway.Close()
	useGatewayScreenModel(t, gateway.URL)
	body, usage, err := forwardScreenModel(t.Context(), "openai/gpt-5", json.RawMessage(`[{"role":"user","content":"look"}]`))
	if err != nil || usage.PromptTokens != 120 || usage.CompletionTokens != 30 || len(body) == 0 {
		t.Fatalf("forward = %s %+v %v", body, usage, err)
	}
	if got["model"] != "openai/gpt-5" || got["max_completion_tokens"] != float64(screenModelMaxOutput) || got["stream"] != false {
		t.Fatalf("client could change the model or limits: %v", got)
	}
	// Reasoning models reject both; the provider default applies.
	if _, ok := got["max_tokens"]; ok {
		t.Fatalf("sent max_tokens: %v", got)
	}
	if _, ok := got["temperature"]; ok {
		t.Fatalf("sent temperature: %v", got)
	}
}

func TestScreenModelUsesTheDeploymentsDirectProvider(t *testing.T) {
	var got map[string]any
	openai := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer openai-key" {
			t.Errorf("unexpected request %s %q", r.URL.Path, r.Header.Get("Authorization"))
		}
		_ = json.NewDecoder(r.Body).Decode(&got)
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ok"}}],"usage":{"prompt_tokens":1,"completion_tokens":1}}`))
	}))
	defer openai.Close()
	t.Setenv("MISTY_AGENT_MODEL_PROVIDER", "openai")
	t.Setenv("MISTY_AGENT_MODEL", "openai/gpt-6-luna")
	t.Setenv("MISTY_AGENT_MODEL_API_KEY", "")
	t.Setenv("OPENAI_API_KEY", "openai-key")
	t.Setenv("MISTY_AGENT_MODEL_BASE_URL", openai.URL+"/v1")
	t.Setenv("AI_GATEWAY_API_KEY", "")
	if _, _, err := forwardScreenModel(t.Context(), "openai/gpt-6-luna", json.RawMessage(`[{"role":"user","content":"look"}]`)); err != nil {
		t.Fatal(err)
	}
	if got["model"] != "gpt-6-luna" || got["reasoning_effort"] != "low" {
		t.Fatalf("direct provider payload = %v", got)
	}
	// A model from another provider cannot be served directly; the deployment's model is used.
	if _, _, err := forwardScreenModel(t.Context(), "anthropic/claude-x", json.RawMessage(`[]`)); err != nil || got["model"] != "gpt-6-luna" {
		t.Fatalf("foreign model = %v %v", got["model"], err)
	}
}

func useGatewayScreenModel(t *testing.T, url string) {
	t.Helper()
	t.Setenv("MISTY_AGENT_MODEL_PROVIDER", "gateway")
	t.Setenv("MISTY_AGENT_MODEL", "")
	t.Setenv("MISTY_AGENT_MODEL_API_KEY", "")
	t.Setenv("MISTY_AGENT_MODEL_BASE_URL", "")
	t.Setenv("AI_GATEWAY_BASE_URL", url)
	t.Setenv("AI_GATEWAY_API_KEY", "gateway-key")
}

func TestScreenModelReportsGatewayFailures(t *testing.T) {
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer gateway.Close()
	useGatewayScreenModel(t, gateway.URL)
	if _, _, err := forwardScreenModel(t.Context(), "openai/gpt-5", json.RawMessage(`[]`)); err == nil {
		t.Fatal("gateway failure was accepted")
	}
	t.Setenv("AI_GATEWAY_API_KEY", "")
	if _, _, err := forwardScreenModel(t.Context(), "openai/gpt-5", json.RawMessage(`[]`)); err == nil {
		t.Fatal("forwarded without a gateway key")
	}
}
