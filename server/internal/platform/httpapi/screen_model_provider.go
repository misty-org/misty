package api

import (
	"encoding/json"
	"strings"

	agent "github.com/kannachi323/misty/server/internal/agents"
	envconfig "github.com/kannachi323/misty/server/internal/platform/config"
)

// screenModelEndpoint is where a screen-planner call goes: the same provider
// the agent runtime uses for this deployment (MISTY_AGENT_MODEL_PROVIDER).
type screenModelEndpoint struct {
	url, key, model string
	// Direct OpenAI reasoning models spend output on reasoning first; keep it
	// short like the server's own agent provider does.
	reasoningEffort string
}

var screenModelBaseURLs = map[string]string{
	"openai":    "https://api.openai.com/v1",
	"anthropic": "https://api.anthropic.com/v1",
	"google":    "https://generativelanguage.googleapis.com/v1beta/openai",
}

func resolveScreenModelEndpoint(model string) (screenModelEndpoint, error) {
	config, err := envconfig.AgentModel()
	if err != nil {
		return screenModelEndpoint{}, errScreenModelUnconfigured
	}
	getenv := func(name string) string { return strings.TrimSpace(envconfig.Getenv(name)) }
	if config.Provider == "gateway" {
		base := getenv("AI_GATEWAY_BASE_URL")
		if base == "" {
			base = agent.TestingDefaultVercelAIBaseURL
		}
		key := getenv("AI_GATEWAY_API_KEY")
		if key == "" {
			return screenModelEndpoint{}, errScreenModelUnconfigured
		}
		return screenModelEndpoint{url: strings.TrimRight(base, "/") + "/chat/completions", key: key, model: model}, nil
	}
	// A direct provider serves only its own models; anything else falls back
	// to the deployment's configured model.
	if !strings.HasPrefix(model, config.Provider+"/") {
		model = config.Model
	}
	base := getenv("MISTY_AGENT_MODEL_BASE_URL")
	if base == "" {
		base = screenModelBaseURLs[config.Provider]
	}
	key := getenv("MISTY_AGENT_MODEL_API_KEY")
	if key == "" && config.Provider == "openai" {
		key = getenv("OPENAI_API_KEY")
	}
	if base == "" || model == "" || (key == "" && config.Provider != "openai-compatible") {
		return screenModelEndpoint{}, errScreenModelUnconfigured
	}
	endpoint := screenModelEndpoint{
		url:   strings.TrimRight(base, "/") + "/chat/completions",
		key:   key,
		model: strings.TrimPrefix(model, config.Provider+"/"),
	}
	if config.Provider == "openai" {
		endpoint.reasoningEffort = "low"
	}
	return endpoint, nil
}

// screenModelPayload uses max_completion_tokens and the provider's default
// temperature: current reasoning models reject max_tokens and temperature 0.
func screenModelPayload(endpoint screenModelEndpoint, messages json.RawMessage) map[string]any {
	payload := map[string]any{
		"model":                 endpoint.model,
		"messages":              messages,
		"max_completion_tokens": screenModelMaxOutput,
		"stream":                false,
	}
	if endpoint.reasoningEffort != "" {
		payload["reasoning_effort"] = endpoint.reasoningEffort
	}
	return payload
}
