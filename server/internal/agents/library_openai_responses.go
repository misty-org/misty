package agent

import (
	"context"
	"encoding/json"
	"errors"
)

func (a *SmartLibraryAnalyzer) analyzeOpenAIResponses(ctx context.Context, model string, chat map[string]any) ([]SmartLibraryMetadata, ModelUsage, error) {
	input := []map[string]any{}
	for _, message := range chat["messages"].([]map[string]any) {
		content := []map[string]any{}
		switch value := message["content"].(type) {
		case string:
			content = append(content, map[string]any{"type": "input_text", "text": value})
		case []map[string]any:
			for _, part := range value {
				if part["type"] == "text" {
					content = append(content, map[string]any{"type": "input_text", "text": part["text"]})
				} else if part["type"] == "image_url" {
					image := part["image_url"].(map[string]any)
					content = append(content, map[string]any{"type": "input_image", "image_url": image["url"], "detail": "high"})
				}
			}
		}
		input = append(input, map[string]any{"role": message["role"], "content": content})
	}
	body := map[string]any{"model": model, "input": input, "max_output_tokens": 6400, "text": map[string]any{"format": map[string]any{"type": "json_schema", "name": "smart_library_analysis_v2", "strict": true, "schema": smartLibrarySchema()}}}
	if a.callReasoning != "" {
		body["reasoning"] = map[string]string{"effort": a.callReasoning}
	}
	var response json.RawMessage
	if err := a.request(ctx, "/responses", body, &response); err != nil {
		return nil, ModelUsage{}, err
	}
	text, err := extractOpenAIText(response)
	if err != nil {
		return nil, ModelUsage{}, err
	}
	var payload struct {
		Assets []SmartLibraryMetadata `json:"assets"`
	}
	if json.Unmarshal([]byte(text), &payload) != nil {
		return nil, ModelUsage{}, errors.New("invalid Library analysis response")
	}
	return payload.Assets, TestingExtractOpenAIUsage(response), nil
}
