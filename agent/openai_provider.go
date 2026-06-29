package agent

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type OpenAIProviderConfig struct {
	APIKey  string
	BaseURL string
	Model   string
	Client  *http.Client
}

type OpenAIProvider struct {
	apiKey  string
	baseURL string
	model   string
	client  *http.Client
}

func NewOpenAIProvider(config OpenAIProviderConfig) *OpenAIProvider {
	baseURL := strings.TrimRight(strings.TrimSpace(config.BaseURL), "/")
	if baseURL == "" {
		baseURL = defaultOpenAIBaseURL
	}
	model := strings.TrimSpace(config.Model)
	if model == "" {
		model = defaultOpenAIModel
	}
	client := config.Client
	if client == nil {
		client = defaultHTTPClient()
	}
	return &OpenAIProvider{
		apiKey:  strings.TrimSpace(config.APIKey),
		baseURL: baseURL,
		model:   model,
		client:  client,
	}
}

func (p *OpenAIProvider) ProviderName() string {
	return ProviderOpenAI
}

func (p *OpenAIProvider) ModelName() string {
	return p.model
}

func (p *OpenAIProvider) Next(request ModelRequest) (ModelResponse, error) {
	if p.apiKey == "" {
		return ModelResponse{}, fmt.Errorf("OPENAI_API_KEY is required")
	}
	body := map[string]any{
		"model": p.model,
		"input": []map[string]any{
			{
				"role": "system",
				"content": []map[string]string{{
					"type": "input_text",
					"text": "Return only JSON that matches the provided schema.",
				}},
			},
			{
				"role": "user",
				"content": []map[string]string{{
					"type": "input_text",
					"text": buildAgentPrompt(request),
				}},
			},
		},
		"text": map[string]any{
			"format": map[string]any{
				"type":   "json_schema",
				"name":   "misty_agent_response",
				"strict": true,
				"schema": agentResponseJSONSchema(),
			},
		},
		"max_output_tokens": 2200,
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return ModelResponse{}, err
	}
	httpRequest, err := http.NewRequest(http.MethodPost, p.baseURL+"/responses", bytes.NewReader(payload))
	if err != nil {
		return ModelResponse{}, err
	}
	httpRequest.Header.Set("Authorization", "Bearer "+p.apiKey)
	httpRequest.Header.Set("Content-Type", "application/json")
	httpResponse, err := p.client.Do(httpRequest)
	if err != nil {
		return ModelResponse{}, err
	}
	defer httpResponse.Body.Close()
	responseBody, _ := io.ReadAll(io.LimitReader(httpResponse.Body, 4<<20))
	if httpResponse.StatusCode < 200 || httpResponse.StatusCode >= 300 {
		return ModelResponse{}, fmt.Errorf("openai request failed: status %d: %s", httpResponse.StatusCode, strings.TrimSpace(string(responseBody)))
	}
	text, err := extractOpenAIText(responseBody)
	if err != nil {
		return ModelResponse{}, err
	}
	return parseProviderJSONResponse(text)
}

func extractOpenAIText(body []byte) (string, error) {
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return "", fmt.Errorf("openai returned invalid JSON: %w", err)
	}
	if text, ok := payload["output_text"].(string); ok && strings.TrimSpace(text) != "" {
		return text, nil
	}
	if text := findTypedText(payload, "output_text"); text != "" {
		return text, nil
	}
	if text := findTypedText(payload, "text"); text != "" {
		return text, nil
	}
	return "", fmt.Errorf("openai response did not contain output text")
}

func findTypedText(value any, textKey string) string {
	switch typed := value.(type) {
	case map[string]any:
		if text, ok := typed[textKey].(string); ok && strings.TrimSpace(text) != "" {
			return text
		}
		for _, child := range typed {
			if text := findTypedText(child, textKey); text != "" {
				return text
			}
		}
	case []any:
		for _, child := range typed {
			if text := findTypedText(child, textKey); text != "" {
				return text
			}
		}
	}
	return ""
}
