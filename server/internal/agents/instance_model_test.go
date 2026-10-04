package agent

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	envconfig "github.com/kannachi323/misty/server/internal/platform/config"
)

func TestDirectOpenAIUsesOneConfiguredModelForEveryAgentTier(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.URL.Path != "/responses" || r.Header.Get("Authorization") != "Bearer openai-fixture" {
			t.Error("wrong direct provider route or credential")
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["model"] != "gpt-6-luna" || body["reasoning"].(map[string]any)["effort"] != "low" {
			t.Error("unexpected model or reasoning effort")
		}
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"message":"fixture rejection"}}`))
	}))
	defer server.Close()
	t.Setenv("MISTY_AGENT_MODEL_PROVIDER", "openai")
	t.Setenv("MISTY_AGENT_MODEL", "openai/gpt-6-luna")
	t.Setenv("MISTY_AGENT_MODEL_API_KEY", "")
	t.Setenv("MISTY_AGENT_MODEL_BASE_URL", server.URL)
	t.Setenv("OPENAI_API_KEY", "openai-fixture")
	t.Setenv("AI_GATEWAY_API_KEY", "unused-gateway-fixture")
	if _, err := envconfig.AgentModel(); err != nil {
		t.Fatal(err)
	}
	provider := NewAgentProviderFromEnv()
	for _, tier := range []AgentTier{TierLow, TierMed, TierHigh} {
		selected := TestingResolveAgentProvider(provider, tier)
		name, model := TestingProviderStatus(selected)
		if name != ProviderOpenAI || model != "gpt-6-luna" {
			t.Fatalf("provider: %s/%s", name, model)
		}
		if _, err := nextProvider(context.Background(), selected, ModelRequest{AgentTier: tier}); err == nil {
			t.Fatal("fixture rejection ignored")
		}
	}
	if requests != 3 {
		t.Fatalf("unexpected attempts: %d", requests)
	}
	models, err := GatewayModels(context.Background())
	if err != nil || len(models) != 1 || models[0].ID != "openai/gpt-6-luna" {
		t.Fatalf("catalog: %#v %v", models, err)
	}
	if _, err := NewGatewayProviderForModelWithReasoning(DefaultFrontierModelID, "high"); err == nil {
		t.Fatal("unconfigured premium model accepted")
	}
}

func TestInstanceModelCatalogWithoutGateway(t *testing.T) {
	t.Setenv("AI_GATEWAY_API_KEY", "")
	t.Setenv("AI_GATEWAY_BASE_URL", "http://127.0.0.1:1")
	t.Setenv("MISTY_AGENT_MODEL_PROVIDER", "anthropic")
	t.Setenv("MISTY_AGENT_MODEL", "anthropic/operator-model")
	t.Setenv("MISTY_AGENT_MODEL_API_KEY", "fixture")
	t.Setenv("MISTY_AGENT_MODEL_BASE_URL", "")
	if FrontierDefaultModelID() != "anthropic/operator-model" {
		t.Fatal("operator model was not selected")
	}
	models, err := FrontierGatewayModels(context.Background())
	if err != nil || len(models) != 1 || models[0].ID != "anthropic/operator-model" {
		t.Fatalf("catalog: %+v %v", models, err)
	}
	if !FrontierModelAvailable(context.Background(), models[0].ID) || !FrontierModelReasoningAvailable(context.Background(), models[0].ID, "high") {
		t.Fatal("configured model rejected")
	}
	if FrontierModelAvailable(context.Background(), DefaultFrontierModelID) {
		t.Fatal("unconfigured model admitted")
	}
}

func TestInstanceModelConfigRejectsInvalidRouting(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "")
	for _, c := range []struct {
		provider, model, key, base string
		valid                      bool
	}{
		{"gateway", "", "", "", true},
		{"openai", "openai/example", "fixture", "", true},
		{"google", "google/example", "fixture", "", true},
		{"openai-compatible", "openai-compatible/local/model", "", "http://localhost:11434/v1", true},
		{"openai", "openai/example", "", "", false},
		{"anthropic", "openai/example", "fixture", "", false},
		{"openai-compatible", "openai-compatible/local", "", "", false},
		{"openai", "openai/example", "fixture", "https://user:secret@example.com", false},
		{"unknown", "unknown/example", "fixture", "", false},
	} {
		t.Run(c.provider+"/"+c.model+"/"+c.base, func(t *testing.T) {
			t.Setenv("MISTY_AGENT_MODEL_PROVIDER", c.provider)
			t.Setenv("MISTY_AGENT_MODEL", c.model)
			t.Setenv("MISTY_AGENT_MODEL_API_KEY", c.key)
			t.Setenv("MISTY_AGENT_MODEL_BASE_URL", c.base)
			_, err := envconfig.AgentModel()
			if (err == nil) != c.valid {
				t.Fatalf("valid=%v: %v", c.valid, err)
			}
		})
	}
}
