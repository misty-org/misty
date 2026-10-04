package agent

import (
	"context"
	"github.com/kannachi323/misty/server/internal/aimodels"
)

func (s *Service) SetModelResolver(resolve aimodels.Resolver) { s.modelResolver = resolve }

func (a *SmartLibraryAnalyzer) WithAIAccount(account string) *SmartLibraryAnalyzer {
	clone := *a
	clone.account = account
	return &clone
}

func (a *SmartLibraryAnalyzer) roleConfig(ctx context.Context, role string) (*aimodels.Resolved, error) {
	if a.ModelResolver == nil || a.account == "" {
		return nil, nil
	}
	if c, ok := a.roleConfigs[role]; ok {
		return c, nil
	}
	return a.ModelResolver(ctx, a.account, role)
}
func (a *SmartLibraryAnalyzer) forRole(ctx context.Context, role string) (*SmartLibraryAnalyzer, *aimodels.Resolved, error) {
	c, err := a.roleConfig(ctx, role)
	if err != nil {
		return nil, nil, err
	}
	if c == nil {
		return a, nil, nil
	}
	clone := *a
	clone.APIKey, clone.BaseURL = c.APIKey, c.BaseURL
	clone.callProvider = c.Provider
	clone.callReasoning = c.Reasoning
	if c.Provider == "gateway" {
		clone.callProvider = ""
	}
	if role == "embedding" {
		clone.EmbeddingModel = c.Model
	}
	client, err := aimodels.HTTPClient(c.BaseURL)
	if err != nil {
		return nil, nil, err
	}
	if clone.Client == nil {
		clone.Client = client
	}
	return &clone, c, nil
}

func (a *SmartLibraryAnalyzer) AccountEmbeddingModel(ctx context.Context) (string, error) {
	c, err := a.roleConfig(ctx, "embedding")
	if err != nil {
		return "", err
	}
	if c != nil {
		return c.Model, nil
	}
	return a.embeddingModel(), nil
}

func accountCompletionProvider(c *aimodels.Resolved) (ModelProvider, error) {
	client, err := aimodels.HTTPClient(c.BaseURL)
	if err != nil {
		return nil, err
	}
	provider := c.Provider
	if provider == "gateway" {
		provider = ProviderVercelAI
	}
	return NewBudgetedProvider(accountNamedProvider{ModelProvider: NewOpenAIProvider(OpenAIProviderConfig{APIKey: c.APIKey, BaseURL: c.BaseURL, Model: aimodels.NativeModel(c.Provider, c.Model), ReasoningEffort: c.Reasoning, ProviderName: provider, Client: client}), model: c.Model}, ProviderBudgetFromEnv()), nil
}

func (a *SmartLibraryAnalyzer) ConfiguredRealtime(ctx context.Context, account string) (*SmartLibraryAnalyzer, bool, error) {
	scoped := a.WithAIAccount(account)
	configured, config, err := scoped.forRole(ctx, "realtime")
	if err != nil {
		return nil, false, err
	}
	clone := *configured
	clone.realtimeConfig = config
	return &clone, config != nil, nil
}
func (a *SmartLibraryAnalyzer) selectedRealtimeModel() string {
	if a.realtimeConfig != nil {
		return a.realtimeConfig.Model
	}
	return RealtimeModelID()
}

type accountNamedProvider struct {
	ModelProvider
	model string
}

func (p accountNamedProvider) ModelName() string { return p.model }
