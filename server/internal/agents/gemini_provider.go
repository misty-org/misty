package agent

import (
	"encoding/json"
)

func TestingExtractGeminiUsage(body []byte) ModelUsage {
	var payload struct {
		InteractionUsage struct {
			InputTokens   int64 `json:"total_input_tokens"`
			CachedTokens  int64 `json:"total_cached_tokens"`
			OutputTokens  int64 `json:"total_output_tokens"`
			ThoughtTokens int64 `json:"total_thought_tokens"`
		} `json:"usage"`
		LegacyUsage struct {
			PromptTokens     int64 `json:"promptTokenCount"`
			CachedTokens     int64 `json:"cachedContentTokenCount"`
			CandidatesTokens int64 `json:"candidatesTokenCount"`
			ThoughtsTokens   int64 `json:"thoughtsTokenCount"`
		} `json:"usageMetadata"`
	}
	if json.Unmarshal(body, &payload) != nil {
		return ModelUsage{}
	}
	if payload.InteractionUsage.InputTokens != 0 || payload.InteractionUsage.OutputTokens != 0 || payload.InteractionUsage.ThoughtTokens != 0 {
		return ModelUsage{InputTokens: payload.InteractionUsage.InputTokens, CachedInputTokens: payload.InteractionUsage.CachedTokens,
			OutputTokens: payload.InteractionUsage.OutputTokens + payload.InteractionUsage.ThoughtTokens, ReasoningTokens: payload.InteractionUsage.ThoughtTokens}
	}
	return ModelUsage{InputTokens: payload.LegacyUsage.PromptTokens, CachedInputTokens: payload.LegacyUsage.CachedTokens,
		OutputTokens: payload.LegacyUsage.CandidatesTokens + payload.LegacyUsage.ThoughtsTokens, ReasoningTokens: payload.LegacyUsage.ThoughtsTokens}
}
