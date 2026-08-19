package agent

import (
	"net/http"
	"strings"
	"time"

	envconfig "github.com/kannachi323/misty/server/internal/platform/config"
)

const (
	ProviderMock     = "mock"
	ProviderOpenAI   = "openai"
	ProviderVercelAI = "vercel_ai_gateway"

	defaultOpenAIBaseURL                = "https://api.openai.com/v1"
	defaultOpenAIModel                  = "gpt-5.5"
	TestingDefaultVercelAIBaseURL       = "https://ai-gateway.vercel.sh/v1"
	TestingDefaultAgentLowGatewayModel  = "google/gemini-2.5-flash-lite"
	TestingDefaultAgentMedGatewayModel  = "google/gemini-2.5-flash"
	TestingDefaultAgentHighGatewayModel = "google/gemini-3.5-flash"
)

func NewAgentProviderFromEnv() ModelProvider {
	apiKey := firstEnv("AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN")
	if apiKey == "" {
		return NewAgentProviderRouter(MockProvider{}, MockProvider{}, MockProvider{})
	}
	baseURL := envOrDefault("AI_GATEWAY_BASE_URL", TestingDefaultVercelAIBaseURL)
	provider := func(modelKey, fallback string) ModelProvider {
		return NewOpenAIProvider(OpenAIProviderConfig{
			APIKey:       apiKey,
			BaseURL:      baseURL,
			Model:        envOrDefault(modelKey, fallback),
			ProviderName: ProviderVercelAI,
		})
	}
	return NewAgentProviderRouter(
		provider("MISTY_AI_LOW_MODEL", TestingDefaultAgentLowGatewayModel),
		provider("MISTY_AI_MED_MODEL", TestingDefaultAgentMedGatewayModel),
		provider("MISTY_AI_HIGH_MODEL", TestingDefaultAgentHighGatewayModel),
	)
}

func defaultHTTPClient() *http.Client {
	return noRedirectHTTPClient(&http.Client{Timeout: 45 * time.Second})
}

func noRedirectHTTPClient(client *http.Client) *http.Client {
	if client == nil {
		client = &http.Client{Timeout: 45 * time.Second}
	}
	cloned := *client
	cloned.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	}
	return &cloned
}

func envOrDefault(key, fallback string) string {
	value := strings.TrimSpace(envconfig.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func firstEnv(keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(envconfig.Getenv(key)); value != "" {
			return value
		}
	}
	return ""
}
