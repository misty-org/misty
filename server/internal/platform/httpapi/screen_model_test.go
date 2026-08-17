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
	t.Setenv("AI_GATEWAY_BASE_URL", gateway.URL)
	t.Setenv("AI_GATEWAY_API_KEY", "gateway-key")
	body, usage, err := forwardScreenModel(t.Context(), "openai/gpt-5", json.RawMessage(`[{"role":"user","content":"look"}]`))
	if err != nil || usage.PromptTokens != 120 || usage.CompletionTokens != 30 || len(body) == 0 {
		t.Fatalf("forward = %s %+v %v", body, usage, err)
	}
	if got["model"] != "openai/gpt-5" || got["max_tokens"] != float64(screenModelMaxOutput) || got["stream"] != false {
		t.Fatalf("client could change the model or limits: %v", got)
	}
}

func TestScreenModelReportsGatewayFailures(t *testing.T) {
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer gateway.Close()
	t.Setenv("AI_GATEWAY_BASE_URL", gateway.URL)
	t.Setenv("AI_GATEWAY_API_KEY", "gateway-key")
	if _, _, err := forwardScreenModel(t.Context(), "openai/gpt-5", json.RawMessage(`[]`)); err == nil {
		t.Fatal("gateway failure was accepted")
	}
	t.Setenv("AI_GATEWAY_API_KEY", "")
	if _, _, err := forwardScreenModel(t.Context(), "openai/gpt-5", json.RawMessage(`[]`)); err == nil {
		t.Fatal("forwarded without a gateway key")
	}
}
