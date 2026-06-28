package ai

import (
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	ProviderMock   = "mock"
	ProviderOpenAI = "openai"
	ProviderGemini = "gemini"

	defaultOpenAIBaseURL = "https://api.openai.com/v1"
	defaultOpenAIModel   = "gpt-5.5"
	defaultGeminiBaseURL = "https://generativelanguage.googleapis.com/v1beta"
	defaultGeminiModel   = "gemini-3.5-flash"
)

func NewProviderFromEnv() ModelProvider {
	providerName := strings.ToLower(strings.TrimSpace(os.Getenv("MISTY_AI_PROVIDER")))
	openAIKey := strings.TrimSpace(os.Getenv("OPENAI_API_KEY"))
	geminiKey := strings.TrimSpace(os.Getenv("GEMINI_API_KEY"))
	if providerName == "" {
		switch {
		case openAIKey != "":
			providerName = ProviderOpenAI
		case geminiKey != "":
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
		if geminiKey == "" {
			return MockProvider{}
		}
		return NewGeminiProvider(GeminiProviderConfig{
			APIKey:  geminiKey,
			BaseURL: envOrDefault("GEMINI_BASE_URL", defaultGeminiBaseURL),
			Model:   envOrDefault("MISTY_AI_MODEL", defaultGeminiModel),
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
