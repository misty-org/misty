package ai

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type GeminiProviderConfig struct {
	APIKey  string
	BaseURL string
	Model   string
	Client  *http.Client
}

type GeminiProvider struct {
	apiKey  string
	baseURL string
	model   string
	client  *http.Client
}

func NewGeminiProvider(config GeminiProviderConfig) *GeminiProvider {
	baseURL := strings.TrimRight(strings.TrimSpace(config.BaseURL), "/")
	if baseURL == "" {
		baseURL = defaultGeminiBaseURL
	}
	model := strings.TrimSpace(config.Model)
	if model == "" {
		model = defaultGeminiModel
	}
	client := config.Client
	if client == nil {
		client = defaultHTTPClient()
	}
	return &GeminiProvider{
		apiKey:  strings.TrimSpace(config.APIKey),
		baseURL: baseURL,
		model:   model,
		client:  client,
	}
}

func (p *GeminiProvider) Next(request ModelRequest) (ModelResponse, error) {
	if p.apiKey == "" {
		return ModelResponse{}, fmt.Errorf("GEMINI_API_KEY is required")
	}
	body := map[string]any{
		"model": p.model,
		"input": buildAgentPrompt(request),
		"response_format": map[string]any{
			"type":      "text",
			"mime_type": "application/json",
			"schema":    agentResponseJSONSchema(),
		},
		"max_output_tokens": 2200,
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return ModelResponse{}, err
	}
	httpRequest, err := http.NewRequest(http.MethodPost, p.baseURL+"/interactions", bytes.NewReader(payload))
	if err != nil {
		return ModelResponse{}, err
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("X-Goog-Api-Key", p.apiKey)
	httpResponse, err := p.client.Do(httpRequest)
	if err != nil {
		return ModelResponse{}, err
	}
	defer httpResponse.Body.Close()
	responseBody, _ := io.ReadAll(io.LimitReader(httpResponse.Body, 4<<20))
	if httpResponse.StatusCode < 200 || httpResponse.StatusCode >= 300 {
		return ModelResponse{}, fmt.Errorf("gemini request failed: status %d: %s", httpResponse.StatusCode, strings.TrimSpace(string(responseBody)))
	}
	text, err := extractGeminiText(responseBody)
	if err != nil {
		return ModelResponse{}, err
	}
	return parseProviderJSONResponse(text)
}

func extractGeminiText(body []byte) (string, error) {
	var generic map[string]any
	if err := json.Unmarshal(body, &generic); err != nil {
		return "", fmt.Errorf("gemini returned invalid JSON: %w", err)
	}
	if text, ok := generic["output_text"].(string); ok && strings.TrimSpace(text) != "" {
		return text, nil
	}
	if text := findTypedText(generic, "output_text"); text != "" {
		return text, nil
	}

	var payload struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	_ = json.Unmarshal(body, &payload)
	for _, candidate := range payload.Candidates {
		for _, part := range candidate.Content.Parts {
			if strings.TrimSpace(part.Text) != "" {
				return part.Text, nil
			}
		}
	}
	return "", fmt.Errorf("gemini response did not contain text")
}
