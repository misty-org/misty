package agent

import (
	"context"
	"strings"
)

type MikaTier string

const (
	MikaLow  MikaTier = "mika-low"
	MikaMed  MikaTier = "mika-med"
	MikaHigh MikaTier = "mika-high"
)

func NormalizeMikaTier(value MikaTier) MikaTier {
	switch MikaTier(strings.ToLower(strings.TrimSpace(string(value)))) {
	case MikaMed:
		return MikaMed
	case MikaHigh:
		return MikaHigh
	default:
		return MikaLow
	}
}

func (tier MikaTier) DisplayName() string {
	switch NormalizeMikaTier(tier) {
	case MikaMed:
		return "Mika Med"
	case MikaHigh:
		return "Mika High"
	default:
		return "Mika Low"
	}
}

type MikaProviderRouter struct {
	providers map[MikaTier]ModelProvider
}

func NewMikaProviderRouter(low, med, high ModelProvider) *MikaProviderRouter {
	if low == nil {
		low = MockProvider{}
	}
	if med == nil {
		med = low
	}
	if high == nil {
		high = med
	}
	return &MikaProviderRouter{providers: map[MikaTier]ModelProvider{
		MikaLow: low, MikaMed: med, MikaHigh: high,
	}}
}

func (router *MikaProviderRouter) ProviderForTier(tier MikaTier) ModelProvider {
	if router == nil {
		return MockProvider{}
	}
	provider := router.providers[NormalizeMikaTier(tier)]
	if provider == nil {
		return MockProvider{}
	}
	return provider
}

func (router *MikaProviderRouter) Next(request ModelRequest) (ModelResponse, error) {
	return router.ProviderForTier(request.MikaTier).Next(request)
}

func (router *MikaProviderRouter) NextContext(ctx context.Context, request ModelRequest) (ModelResponse, error) {
	return nextProvider(ctx, router.ProviderForTier(request.MikaTier), request)
}

// ProviderInfo on the router is deliberately provider-neutral. Internal callers
// that need billing metadata resolve the concrete provider with ProviderForTier.
func (*MikaProviderRouter) ProviderName() string { return "misty" }
func (*MikaProviderRouter) ModelName() string    { return string(MikaLow) }

type mikaProviderResolver interface {
	ProviderForTier(MikaTier) ModelProvider
}

func resolveMikaProvider(provider ModelProvider, tier MikaTier) ModelProvider {
	if resolver, ok := provider.(mikaProviderResolver); ok {
		return resolver.ProviderForTier(tier)
	}
	return provider
}

func nextProvider(ctx context.Context, provider ModelProvider, request ModelRequest) (ModelResponse, error) {
	if contextual, ok := provider.(ContextModelProvider); ok {
		return contextual.NextContext(ctx, request)
	}
	return provider.Next(request)
}
