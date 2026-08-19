package api

import (
	"context"
	"encoding/json"
	"strings"

	agent "github.com/kannachi323/misty/server/internal/agents"
	"github.com/kannachi323/misty/server/internal/aimodels"
	envconfig "github.com/kannachi323/misty/server/internal/platform/config"
	db "github.com/kannachi323/misty/server/internal/platform/postgres"
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

// screenModelRoute is the run's vision route, which the account can point at
// its own provider; billing meters screen calls against the same route.
func (s *SpacesService) screenModelRoute(ctx context.Context, record *db.AIInvocationRecord) (screenModelEndpoint, error) {
	route, err := s.database.AIModelRunRoute(ctx, record.UserID, record.ID, "vision")
	if err != nil {
		return screenModelEndpoint{}, err
	}
	model := route.Model
	if model == "" {
		model = aiInvocationMeteredModel(record)
	}
	account, err := s.resolveAIRoute(ctx, record.UserID, route)
	if err != nil {
		return screenModelEndpoint{}, err
	}
	if account == nil {
		return resolveScreenModelEndpoint(model)
	}
	return accountScreenModelEndpoint(*account, model)
}

// accountScreenModelEndpoint uses the account's own provider connection.
func accountScreenModelEndpoint(account aimodels.Resolved, model string) (screenModelEndpoint, error) {
	base := strings.TrimRight(account.BaseURL, "/")
	switch {
	case base == "" && account.Provider == "gateway":
		base = agent.TestingDefaultVercelAIBaseURL
	case base == "":
		base = screenModelBaseURLs[account.Provider]
	case account.Provider == "google" && !strings.HasSuffix(base, "/openai"):
		base += "/openai"
	}
	if base == "" || model == "" {
		return screenModelEndpoint{}, errScreenModelUnconfigured
	}
	endpoint := screenModelEndpoint{url: base + "/chat/completions", key: account.APIKey, model: model}
	if account.Provider != "gateway" {
		endpoint.model = strings.TrimPrefix(model, account.Provider+"/")
	}
	if account.Provider == "openai" {
		endpoint.reasoningEffort = "low"
	}
	return endpoint, nil
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
