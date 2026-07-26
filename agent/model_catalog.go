package agent

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	GatewayModelCatalogVersion = "gateway-live-v2"
	InitialSelectedModelID     = "google/gemini-2.5-flash-lite"
	InitialSelectedModelName   = "Gemini 2.5 Flash-Lite"
)

var ErrModelUnavailable = errors.New("agent model unavailable")

type GatewayModel struct {
	ID                           string   `json:"id"`
	Name                         string   `json:"name"`
	Capabilities                 []string `json:"capabilities"`
	InputRateMilliUSDPerMillion  int64    `json:"-"`
	CachedRateMilliUSDPerMillion int64    `json:"-"`
	OutputRateMilliUSDPerMillion int64    `json:"-"`
	HasTokenPricing              bool     `json:"-"`
}

var gatewayCatalogCache struct {
	sync.Mutex
	models    []GatewayModel
	expiresAt time.Time
}

func GatewayModels(ctx context.Context) ([]GatewayModel, error) {
	gatewayCatalogCache.Lock()
	if time.Now().Before(gatewayCatalogCache.expiresAt) && len(gatewayCatalogCache.models) > 0 {
		models := append([]GatewayModel(nil), gatewayCatalogCache.models...)
		gatewayCatalogCache.Unlock()
		return models, nil
	}
	gatewayCatalogCache.Unlock()

	models, err := fetchGatewayModels(ctx)
	if err != nil || len(models) == 0 {
		models = configuredGatewayModels()
	}
	if len(models) == 0 {
		return nil, errors.New("gateway model catalog is unavailable")
	}
	sort.Slice(models, func(i, j int) bool { return strings.ToLower(models[i].Name) < strings.ToLower(models[j].Name) })
	gatewayCatalogCache.Lock()
	gatewayCatalogCache.models = append([]GatewayModel(nil), models...)
	gatewayCatalogCache.expiresAt = time.Now().Add(10 * time.Minute)
	gatewayCatalogCache.Unlock()
	return models, nil
}

func GatewayModelAvailable(ctx context.Context, modelID string) bool {
	modelID = strings.TrimSpace(modelID)
	models, err := GatewayModels(ctx)
	if err != nil {
		return false
	}
	for _, model := range models {
		if model.ID == modelID {
			return true
		}
	}
	return false
}

func GatewayModelSupportsTools(ctx context.Context, modelID string) bool {
	models, err := GatewayModels(ctx)
	if err != nil {
		return false
	}
	for _, model := range models {
		if model.ID != strings.TrimSpace(modelID) {
			continue
		}
		for _, capability := range model.Capabilities {
			switch strings.ToLower(strings.TrimSpace(capability)) {
			case "tools", "tool-use", "tool_calling", "function_calling":
				return true
			}
		}
		return false
	}
	return false
}

// GatewayModelSupportsReasoning reports whether a model exposes adjustable
// reasoning effort, based on the capabilities the gateway advertises. Keep the
// capability strings in sync with modelSupportsReasoning on the client.
func GatewayModelSupportsReasoning(ctx context.Context, modelID string) bool {
	models, err := GatewayModels(ctx)
	if err != nil {
		return false
	}
	for _, model := range models {
		if model.ID != strings.TrimSpace(modelID) {
			continue
		}
		for _, capability := range model.Capabilities {
			switch strings.ToLower(strings.TrimSpace(capability)) {
			case "reasoning", "thinking", "reasoning-effort":
				return true
			}
		}
		return false
	}
	return false
}

// CachedGatewayModelRates exposes server-only gateway pricing to the usage
// meter without sending prices to clients. Values are thousandths of a dollar
// per million tokens, matching the versioned Hosted AI rate-card units.
func CachedGatewayModelRates(modelID string) (input, cachedInput, output int64, ok bool) {
	gatewayCatalogCache.Lock()
	defer gatewayCatalogCache.Unlock()
	for _, model := range gatewayCatalogCache.models {
		if model.ID == strings.TrimSpace(modelID) && model.HasTokenPricing {
			cached := model.CachedRateMilliUSDPerMillion
			if cached <= 0 {
				cached = model.InputRateMilliUSDPerMillion
			}
			return model.InputRateMilliUSDPerMillion, cached, model.OutputRateMilliUSDPerMillion, true
		}
	}
	return 0, 0, 0, false
}

func NewGatewayProviderForModel(modelID string) (ModelProvider, error) {
	return NewGatewayProviderForModelWithReasoning(modelID, "")
}

func NewGatewayProviderForModelWithReasoning(modelID, reasoningEffort string) (ModelProvider, error) {
	modelID = strings.TrimSpace(modelID)
	if modelID == "" || strings.ContainsAny(modelID, "\r\n\t ") || len(modelID) > 200 {
		return nil, errors.New("invalid gateway model")
	}
	apiKey := firstEnv("AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN")
	if apiKey == "" {
		return nil, errors.New("AI gateway is not configured")
	}
	return NewOpenAIProvider(OpenAIProviderConfig{APIKey: apiKey, BaseURL: envOrDefault("AI_GATEWAY_BASE_URL", defaultVercelAIBaseURL), Model: modelID, ProviderName: ProviderVercelAI, ReasoningEffort: strings.TrimSpace(reasoningEffort)}), nil
}

func configuredGatewayModels() []GatewayModel {
	var configured []GatewayModel
	if json.Unmarshal([]byte(strings.TrimSpace(os.Getenv("MISTY_AI_MODEL_CATALOG_JSON"))), &configured) == nil {
		return filterChatModels(configured)
	}
	ids := []string{
		envOrDefault("MISTY_AI_LOW_MODEL", defaultAgentLowGatewayModel),
		envOrDefault("MISTY_AI_MED_MODEL", defaultAgentMedGatewayModel),
		envOrDefault("MISTY_AI_HIGH_MODEL", defaultAgentHighGatewayModel),
	}
	seen := map[string]bool{}
	out := []GatewayModel{}
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, GatewayModel{ID: id, Name: modelDisplayName(id), Capabilities: []string{"chat", "tools"}})
	}
	return out
}

func fetchGatewayModels(ctx context.Context) ([]GatewayModel, error) {
	apiKey := firstEnv("AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN")
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimSuffix(envOrDefault("AI_GATEWAY_BASE_URL", defaultVercelAIBaseURL), "/")+"/models", nil)
	if err != nil {
		return nil, err
	}
	// Vercel intentionally exposes model discovery without authentication. Keep
	// sending credentials when configured so private/custom gateway endpoints
	// remain compatible, but do not collapse the public catalog to three local
	// fallback models just because this process has no inference key.
	if apiKey != "" {
		request.Header.Set("Authorization", "Bearer "+apiKey)
	}
	response, err := defaultHTTPClient().Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, errors.New("gateway model catalog request failed")
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	var payload struct {
		Data []struct {
			ID           string                     `json:"id"`
			Name         string                     `json:"name"`
			Type         string                     `json:"type"`
			Tags         []string                   `json:"tags"`
			Capabilities json.RawMessage            `json:"capabilities"`
			Pricing      map[string]json.RawMessage `json:"pricing"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}
	models := make([]GatewayModel, 0, len(payload.Data))
	for _, item := range payload.Data {
		itemType := strings.ToLower(strings.TrimSpace(item.Type))
		if itemType != "" && !strings.Contains(itemType, "language") && !strings.Contains(itemType, "chat") && !strings.Contains(itemType, "text") {
			continue
		}
		input, inputOK := gatewayTokenRate(item.Pricing["input"])
		output, outputOK := gatewayTokenRate(item.Pricing["output"])
		cached, _ := gatewayTokenRate(firstPricingValue(item.Pricing, "cached_input", "input_cache_read", "cache_read"))
		capabilities := gatewayCapabilities(item.Capabilities)
		if len(item.Tags) > 0 {
			capabilities = append(capabilities, item.Tags...)
		}
		// The endpoint's type is authoritative. Adding it to the normalized
		// capabilities keeps language models with specialized tags (for example
		// web search only) in the chat catalog.
		capabilities = append(capabilities, "language")
		models = append(models, GatewayModel{
			ID: item.ID, Name: item.Name, Capabilities: normalizedCapabilities(capabilities),
			InputRateMilliUSDPerMillion: input, CachedRateMilliUSDPerMillion: cached,
			OutputRateMilliUSDPerMillion: output, HasTokenPricing: inputOK && outputOK,
		})
	}
	return filterChatModels(models), nil
}

func gatewayCapabilities(raw json.RawMessage) []string {
	var list []string
	if json.Unmarshal(raw, &list) == nil {
		return list
	}
	var values map[string]any
	if json.Unmarshal(raw, &values) != nil {
		return nil
	}
	for key, value := range values {
		if enabled, ok := value.(bool); !ok || enabled {
			list = append(list, key)
		}
	}
	sort.Strings(list)
	return list
}

func normalizedCapabilities(capabilities []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(capabilities))
	for _, capability := range capabilities {
		capability = strings.TrimSpace(capability)
		key := strings.ToLower(capability)
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, capability)
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i]) < strings.ToLower(out[j]) })
	return out
}

func firstPricingValue(pricing map[string]json.RawMessage, keys ...string) json.RawMessage {
	for _, key := range keys {
		if len(pricing[key]) > 0 {
			return pricing[key]
		}
	}
	return nil
}

func gatewayTokenRate(raw json.RawMessage) (int64, bool) {
	if len(raw) == 0 {
		return 0, false
	}
	var value string
	if raw[0] == '"' {
		if json.Unmarshal(raw, &value) != nil {
			return 0, false
		}
	} else {
		value = string(raw)
	}
	perTokenUSD, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil || perTokenUSD < 0 {
		return 0, false
	}
	// USD/token × 1,000,000 tokens × 1,000 converts to the meter's
	// thousandths-of-USD-per-million-token unit.
	rate := int64(perTokenUSD*1_000_000_000 + 0.5)
	return rate, true
}

func filterChatModels(models []GatewayModel) []GatewayModel {
	seen := map[string]bool{}
	out := []GatewayModel{}
	for _, model := range models {
		model.ID = strings.TrimSpace(model.ID)
		lower := strings.ToLower(model.ID + " " + model.Name)
		if model.ID == "" || seen[model.ID] || strings.Contains(lower, "embedding") || strings.Contains(lower, "rerank") || strings.Contains(lower, "transcrib") || strings.Contains(lower, "image") || strings.Contains(lower, "video") {
			continue
		}
		if len(model.Capabilities) > 0 && !hasTextGenerationCapability(model.Capabilities) {
			continue
		}
		seen[model.ID] = true
		if strings.TrimSpace(model.Name) == "" {
			model.Name = modelDisplayName(model.ID)
		}
		if len(model.Capabilities) == 0 {
			model.Capabilities = []string{"chat"}
		}
		out = append(out, model)
	}
	return out
}

func hasTextGenerationCapability(capabilities []string) bool {
	for _, capability := range capabilities {
		switch strings.ToLower(strings.TrimSpace(capability)) {
		case "chat", "language", "text", "text_generation", "generation", "reasoning", "tools", "tool-use", "tool_calling", "function_calling", "vision":
			return true
		}
	}
	return false
}

func modelDisplayName(id string) string {
	if slash := strings.LastIndex(id, "/"); slash >= 0 && slash < len(id)-1 {
		return id[slash+1:]
	}
	return id
}
