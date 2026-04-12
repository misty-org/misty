package ai

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

func TestBuildGeminiContentsInjectsContextIntoLastUserMessage(t *testing.T) {
	req := FileContextRequest{
		Prompt:  "Summarize this folder",
		Context: "Current path: /tmp/project\nVisible items: 2",
		History: []Message{
			{Role: "user", Content: "What is here?"},
			{Role: "assistant", Content: "A project folder."},
			{Role: "user", Content: "Summarize this folder"},
		},
	}

	contents := buildGeminiContents(req)
	if len(contents) != 3 {
		t.Fatalf("expected 3 contents, got %d", len(contents))
	}
	lastParts := contents[2]["parts"].([]map[string]string)
	if !strings.Contains(lastParts[0]["text"], "[File explorer context]") {
		t.Fatalf("expected context to be injected into the last user message")
	}
	if contents[1]["role"] != "model" {
		t.Fatalf("expected assistant messages to map to model role")
	}
}

func TestGenerateFileContextReply(t *testing.T) {
	client := &http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			if r.Header.Get("x-goog-api-key") != "test-key" {
				t.Fatalf("missing api key header")
			}
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode request: %v", err)
			}
			respBody, _ := json.Marshal(map[string]any{
				"candidates": []map[string]any{
					{
						"content": map[string]any{
							"parts": []map[string]string{
								{"text": "Folder summary"},
							},
						},
					},
				},
			})
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(strings.NewReader(string(respBody))),
			}, nil
		}),
	}

	svc := &Service{
		apiKey:  "test-key",
		model:   "gemini-2.5-flash",
		baseURL: "https://example.test",
		client:  client,
	}

	text, err := svc.GenerateFileContextReply(context.Background(), FileContextRequest{
		Prompt:  "Summarize this folder",
		Context: "Current path: /tmp",
		History: []Message{{Role: "user", Content: "Summarize this folder"}},
	})
	if err != nil {
		t.Fatalf("GenerateFileContextReply returned error: %v", err)
	}
	if text != "Folder summary" {
		t.Fatalf("unexpected response text: %q", text)
	}
}
