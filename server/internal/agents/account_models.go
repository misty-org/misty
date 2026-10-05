package agent

import (
	"context"

	"github.com/kannachi323/misty/server/internal/aimodels"
	"github.com/kannachi323/misty/server/internal/modelruntime"
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

// embeddingRoute is where this account's embeddings go and the model they use.
func (a *SmartLibraryAnalyzer) embeddingRoute(ctx context.Context) (modelruntime.Route, string, error) {
	c, err := a.roleConfig(ctx, "embedding")
	if err != nil {
		return modelruntime.Route{}, "", err
	}
	if c != nil {
		return modelruntime.For(c), c.Model, nil
	}
	return modelruntime.Instance(), a.embeddingModel(), nil
}

// forRealtime points the realtime voice socket at the account's own
// connection. Realtime voice is the one model connection Go still opens.
func (a *SmartLibraryAnalyzer) forRealtime(ctx context.Context) (*SmartLibraryAnalyzer, *aimodels.Resolved, error) {
	c, err := a.roleConfig(ctx, "realtime")
	if err != nil || c == nil {
		return a, nil, err
	}
	clone := *a
	clone.APIKey, clone.BaseURL = c.APIKey, c.BaseURL
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

func accountCompletionProvider(models *modelruntime.Client, c *aimodels.Resolved) (ModelProvider, error) {
	if !models.Enabled() {
		return nil, modelruntime.ErrUnavailable
	}
	provider := c.Provider
	if provider == "gateway" {
		provider = ProviderVercelAI
	}
	return NewBudgetedProvider(NewRuntimeProvider(models, modelruntime.For(c), c.Model, provider, c.Reasoning), ProviderBudgetFromEnv()), nil
}

func (a *SmartLibraryAnalyzer) ConfiguredRealtime(ctx context.Context, account string) (*SmartLibraryAnalyzer, bool, error) {
	scoped := a.WithAIAccount(account)
	configured, config, err := scoped.forRealtime(ctx)
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
	return AgentRealtimeModel
}
