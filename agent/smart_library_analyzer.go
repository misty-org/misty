package agent

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const (
	SmartLibraryPrimaryModel   = "google/gemini-2.5-flash-lite"
	SmartLibraryFallbackModel  = "google/gemini-3.1-flash-lite"
	SmartLibraryEmbeddingModel = "openai/text-embedding-3-small"
	SmartLibraryMaxBatchSize   = 8
)

type SmartLibraryImage struct {
	AssetID, MimeType string
	Bytes             []byte
}
type SmartLibraryMetadata struct {
	AssetID              string   `json:"assetId"`
	Description          string   `json:"description"`
	Tags                 []string `json:"tags"`
	SuggestedCollections []string `json:"suggestedCollections"`
	Confidence           float64  `json:"confidence"`
	Model                string   `json:"-"`
	FallbackReason       string   `json:"-"`
}
type SmartLibraryAnalysis struct {
	Results  []SmartLibraryMetadata
	Failures map[string]string
	Usage    ModelUsage
}

type SmartLibraryAnalyzer struct {
	APIKey, BaseURL     string
	Client              *http.Client
	ConfidenceThreshold float64
}

func (a *SmartLibraryAnalyzer) Analyze(ctx context.Context, images []SmartLibraryImage) (SmartLibraryAnalysis, error) {
	if len(images) == 0 || len(images) > SmartLibraryMaxBatchSize {
		return SmartLibraryAnalysis{}, errors.New("smart library batches must contain one to eight images")
	}
	primary, usage, err := a.analyzeWithModel(ctx, SmartLibraryPrimaryModel, images)
	analysis := SmartLibraryAnalysis{Failures: map[string]string{}, Usage: usage}
	byID := map[string]SmartLibraryMetadata{}
	for _, result := range primary {
		byID[result.AssetID] = result
	}
	for _, image := range images {
		result, found := byID[image.AssetID]
		reason := metadataFallbackReason(result, found, a.threshold())
		if err != nil && reason == "" {
			reason = "primary_request_failed"
		}
		if reason == "" {
			result.Model = SmartLibraryPrimaryModel
			analysis.Results = append(analysis.Results, result)
			continue
		}
		fallback, fallbackUsage, fallbackErr := a.analyzeWithModel(ctx, SmartLibraryFallbackModel, []SmartLibraryImage{image})
		analysis.Usage.InputTokens += fallbackUsage.InputTokens
		analysis.Usage.OutputTokens += fallbackUsage.OutputTokens
		if fallbackErr != nil || len(fallback) != 1 || fallback[0].AssetID != image.AssetID || metadataFallbackReason(fallback[0], len(fallback) == 1, a.threshold()) != "" {
			analysis.Failures[image.AssetID] = "analysis_quality_failed"
			continue
		}
		fallback[0].Model = SmartLibraryFallbackModel
		fallback[0].FallbackReason = reason
		analysis.Results = append(analysis.Results, fallback[0])
	}
	if len(analysis.Results) == 0 && err != nil {
		return analysis, err
	}
	return analysis, nil
}

func (a *SmartLibraryAnalyzer) Embed(ctx context.Context, inputs []string) ([][]float64, ModelUsage, error) {
	if len(inputs) == 0 {
		return nil, ModelUsage{}, nil
	}
	body := map[string]any{"model": SmartLibraryEmbeddingModel, "input": inputs, "encoding_format": "float"}
	var response struct {
		Data []struct {
			Embedding []float64 `json:"embedding"`
		} `json:"data"`
		Usage struct {
			PromptTokens int64 `json:"prompt_tokens"`
			TotalTokens  int64 `json:"total_tokens"`
		} `json:"usage"`
	}
	if err := a.request(ctx, "/embeddings", body, &response); err != nil {
		return nil, ModelUsage{}, err
	}
	vectors := make([][]float64, len(response.Data))
	for index, item := range response.Data {
		vectors[index] = item.Embedding
	}
	return vectors, ModelUsage{InputTokens: response.Usage.PromptTokens}, nil
}

func (a *SmartLibraryAnalyzer) analyzeWithModel(ctx context.Context, model string, images []SmartLibraryImage) ([]SmartLibraryMetadata, ModelUsage, error) {
	content := []map[string]any{{"type": "text", "text": "Analyze every image. Return useful concrete descriptions, normalized visual tags, broad reusable virtual collections, and calibrated confidence. Preserve each opaque asset ID exactly."}}
	for _, image := range images {
		content = append(content, map[string]any{"type": "text", "text": "Asset ID: " + image.AssetID}, map[string]any{"type": "image_url", "image_url": map[string]any{"url": "data:" + image.MimeType + ";base64," + base64.StdEncoding.EncodeToString(image.Bytes), "detail": "low"}})
	}
	body := map[string]any{"model": model, "messages": []map[string]any{{"role": "system", "content": "Return only strict JSON. Do not identify people. Do not infer sensitive traits."}, {"role": "user", "content": content}}, "reasoning_effort": "minimal", "response_format": map[string]any{"type": "json_schema", "json_schema": map[string]any{"name": "smart_library_analysis", "strict": true, "schema": smartLibrarySchema()}}, "max_tokens": 1600}
	var response struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Usage struct {
			PromptTokens        int64 `json:"prompt_tokens"`
			CompletionTokens    int64 `json:"completion_tokens"`
			PromptTokensDetails struct {
				CachedTokens int64 `json:"cached_tokens"`
			} `json:"prompt_tokens_details"`
		} `json:"usage"`
	}
	if err := a.request(ctx, "/chat/completions", body, &response); err != nil {
		return nil, ModelUsage{}, err
	}
	if len(response.Choices) == 0 {
		return nil, ModelUsage{}, errors.New("gateway returned no choices")
	}
	var payload struct {
		Assets []SmartLibraryMetadata `json:"assets"`
	}
	if err := json.Unmarshal([]byte(response.Choices[0].Message.Content), &payload); err != nil {
		return nil, ModelUsage{}, fmt.Errorf("invalid smart library schema: %w", err)
	}
	return payload.Assets, ModelUsage{InputTokens: response.Usage.PromptTokens, CachedInputTokens: response.Usage.PromptTokensDetails.CachedTokens, OutputTokens: response.Usage.CompletionTokens}, nil
}

func (a *SmartLibraryAnalyzer) request(ctx context.Context, path string, body any, dst any) error {
	key := strings.TrimSpace(a.APIKey)
	if key == "" {
		return errors.New("AI Gateway key is required")
	}
	base := strings.TrimRight(strings.TrimSpace(a.BaseURL), "/")
	if base == "" {
		base = "https://ai-gateway.vercel.sh/v1"
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, base+path, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+key)
	request.Header.Set("Content-Type", "application/json")
	client := a.Client
	if client == nil {
		client = &http.Client{Timeout: 60 * time.Second}
	}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("AI Gateway status %d", response.StatusCode)
	}
	if err = json.Unmarshal(raw, dst); err != nil {
		return fmt.Errorf("AI Gateway returned invalid JSON: %w", err)
	}
	return nil
}
func (a *SmartLibraryAnalyzer) threshold() float64 {
	if a.ConfidenceThreshold > 0 && a.ConfidenceThreshold <= 1 {
		return a.ConfidenceThreshold
	}
	return .55
}
func metadataFallbackReason(result SmartLibraryMetadata, found bool, threshold float64) string {
	if !found {
		return "schema_invalid"
	}
	description := strings.TrimSpace(result.Description)
	if len(description) < 12 || strings.EqualFold(description, "an image") || strings.EqualFold(description, "a photo") {
		return "description_empty_or_generic"
	}
	if len(result.Tags) < 3 {
		return "required_categories_missing"
	}
	if result.Confidence < threshold {
		return "confidence_below_evaluated_threshold"
	}
	return ""
}
func smartLibrarySchema() map[string]any {
	return map[string]any{"type": "object", "additionalProperties": false, "required": []string{"assets"}, "properties": map[string]any{"assets": map[string]any{"type": "array", "maxItems": 8, "items": map[string]any{"type": "object", "additionalProperties": false, "required": []string{"assetId", "description", "tags", "suggestedCollections", "confidence"}, "properties": map[string]any{"assetId": map[string]any{"type": "string"}, "description": map[string]any{"type": "string", "minLength": 12, "maxLength": 320}, "tags": map[string]any{"type": "array", "minItems": 3, "maxItems": 16, "items": map[string]any{"type": "string"}}, "suggestedCollections": map[string]any{"type": "array", "maxItems": 5, "items": map[string]any{"type": "string"}}, "confidence": map[string]any{"type": "number", "minimum": 0, "maximum": 1}}}}}}
}
