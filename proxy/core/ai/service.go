package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	defaultModel   = "gemini-2.5-flash"
	defaultBaseURL = "https://generativelanguage.googleapis.com"
)

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type FileContextRequest struct {
	Prompt  string    `json:"prompt"`
	Context string    `json:"context"`
	History []Message `json:"history"`
}

type Service struct {
	apiKey  string
	model   string
	baseURL string
	client  *http.Client
}

func NewServiceFromEnv() *Service {
	apiKey := strings.TrimSpace(os.Getenv("GEMINI_API_KEY"))
	if apiKey == "" {
		apiKey = strings.TrimSpace(os.Getenv("GOOGLE_API_KEY"))
	}

	model := strings.TrimSpace(os.Getenv("MISTY_AI_MODEL"))
	if model == "" {
		model = defaultModel
	}

	baseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("MISTY_AI_BASE_URL")), "/")
	if baseURL == "" {
		baseURL = defaultBaseURL
	}

	return &Service{
		apiKey:  apiKey,
		model:   model,
		baseURL: baseURL,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (s *Service) Ready() bool {
	return s != nil && s.apiKey != ""
}

func (s *Service) Model() string {
	if s == nil || s.model == "" {
		return defaultModel
	}
	return s.model
}

func (s *Service) GenerateFileContextReply(ctx context.Context, req FileContextRequest) (string, error) {
	if s == nil || !s.Ready() {
		return "", fmt.Errorf("Misty AI is not configured on the proxy")
	}

	prompt := strings.TrimSpace(req.Prompt)
	if prompt == "" {
		return "", fmt.Errorf("prompt is required")
	}

	payload := map[string]any{
		"contents":         buildGeminiContents(req),
		"generationConfig": map[string]any{"temperature": 0.4, "maxOutputTokens": 1024},
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}

	url := fmt.Sprintf("%s/v1beta/models/%s:generateContent", s.baseURL, s.Model())
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-goog-api-key", s.apiKey)

	resp, err := s.client.Do(httpReq)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var geminiResp struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&geminiResp); err != nil {
		return "", err
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		if geminiResp.Error != nil && strings.TrimSpace(geminiResp.Error.Message) != "" {
			return "", errors.New(strings.TrimSpace(geminiResp.Error.Message))
		}
		return "", fmt.Errorf("Gemini request failed with status %d", resp.StatusCode)
	}

	if len(geminiResp.Candidates) == 0 {
		return "", fmt.Errorf("Gemini returned no candidates")
	}

	var out strings.Builder
	for _, part := range geminiResp.Candidates[0].Content.Parts {
		out.WriteString(part.Text)
	}

	result := strings.TrimSpace(out.String())
	if result == "" {
		return "", fmt.Errorf("Gemini returned an empty response")
	}

	return result, nil
}

func buildGeminiContents(req FileContextRequest) []map[string]any {
	history := req.History
	contents := make([]map[string]any, 0, len(history))
	for i, msg := range history {
		role := "user"
		if msg.Role == "assistant" {
			role = "model"
		}

		text := strings.TrimSpace(msg.Content)
		if text == "" {
			continue
		}

		if i == len(history)-1 && msg.Role != "assistant" {
			var builder strings.Builder
			builder.WriteString("You are Misty's file explorer assistant. Answer concisely and only claim facts supported by the provided context. If the context is missing something, say so plainly.\n\n")
			if ctx := strings.TrimSpace(req.Context); ctx != "" {
				builder.WriteString("[File explorer context]\n")
				builder.WriteString(ctx)
				builder.WriteString("\n\n")
			}
			builder.WriteString("[User request]\n")
			builder.WriteString(text)
			text = builder.String()
		}

		contents = append(contents, map[string]any{
			"role": role,
			"parts": []map[string]string{
				{"text": text},
			},
		})
	}

	if len(contents) == 0 {
		contents = append(contents, map[string]any{
			"role": "user",
			"parts": []map[string]string{
				{"text": strings.TrimSpace(req.Prompt)},
			},
		})
	}

	return contents
}
