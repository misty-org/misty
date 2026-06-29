package agent

import (
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	ProviderMock       = "mock"
	ProviderOpenAI     = "openai"
	ProviderGemini     = "gemini"
	ProviderGeminiREST = "gemini_rest"

	defaultOpenAIBaseURL = "https://api.openai.com/v1"
	defaultOpenAIModel   = "gpt-5.5"
	defaultGeminiBaseURL = "https://generativelanguage.googleapis.com/v1beta"
	defaultGeminiModel   = "gemini-3.5-flash"
)

func NewProviderFromEnv() ModelProvider {
	providerName := strings.ToLower(strings.TrimSpace(os.Getenv("MISTY_AI_PROVIDER")))
	openAIKey := strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
	geminiKey := firstEnv("GEMINI_API_KEY", "GOOGLE_API_KEY")
	geminiAuthMode := strings.ToLower(strings.TrimSpace(os.Getenv("GEMINI_AUTH_MODE")))
	if providerName == "" {
		switch {
		case openAIKey != "":
			providerName = ProviderOpenAI
		case geminiKey != "" || geminiAuthMode == geminiAuthADC:
			providerName = ProviderGemini
		default:
			providerName = ProviderMock
		}
	}

	switch providerName {
	case ProviderOpenAI:
		if openAIKey == "" {
			return MockProvider{}
		}
		return NewOpenAIProvider(OpenAIProviderConfig{
			APIKey:  openAIKey,
			BaseURL: envOrDefault("OPENAI_BASE_URL", defaultOpenAIBaseURL),
			Model:   envOrDefault("MISTY_AI_MODEL", defaultOpenAIModel),
		})
	case ProviderGemini:
		if geminiKey == "" && geminiAuthMode == geminiAuthAPIKey {
			return MockProvider{}
		}
		return NewADKGeminiProvider(ADKGeminiProviderConfig{
			APIKey:   geminiKey,
			AuthMode: envOrDefault("GEMINI_AUTH_MODE", geminiAuthAuto),
			Model:    envOrDefault("MISTY_AI_MODEL", defaultGeminiModel),
			Project:  firstEnv("GEMINI_VERTEX_PROJECT", "GOOGLE_CLOUD_PROJECT"),
			Location: firstEnv("GEMINI_VERTEX_LOCATION", "GOOGLE_CLOUD_LOCATION", "GOOGLE_CLOUD_REGION"),
		})
	case ProviderGeminiREST:
		if geminiKey == "" && geminiAuthMode == geminiAuthAPIKey {
			return MockProvider{}
		}
		return NewGeminiProvider(GeminiProviderConfig{
			APIKey:     geminiKey,
			AuthMode:   envOrDefault("GEMINI_AUTH_MODE", geminiAuthAuto),
			BaseURL:    envOrDefault("GEMINI_BASE_URL", defaultGeminiBaseURL),
			Model:      envOrDefault("MISTY_AI_MODEL", defaultGeminiModel),
			OAuthScope: envOrDefault("GEMINI_OAUTH_SCOPE", defaultGeminiOAuthScope),
		})
	default:
		return MockProvider{}
	}
}

func defaultHTTPClient() *http.Client {
	return &http.Client{Timeout: 45 * time.Second}
}

func envOrDefault(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func firstEnv(keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return ""
}
