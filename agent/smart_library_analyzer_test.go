package agent

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

func TestSmartLibraryAnalyzerRoutesLowConfidenceToSingleFallback(t *testing.T) {
	var mu sync.Mutex
	models := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]any
		_ = json.NewDecoder(r.Body).Decode(&request)
		model, _ := request["model"].(string)
		mu.Lock()
		models = append(models, model)
		mu.Unlock()
		confidence := .2
		if model == SmartLibraryFallbackModel {
			confidence = .9
		}
		content, _ := json.Marshal(map[string]any{"assets": []map[string]any{{"assetId": "asset_1", "description": "A blue ceramic cup on a wooden table.", "tags": []string{"blue", "cup", "table"}, "suggestedCollections": []string{"Product photos"}, "confidence": confidence}}})
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []map[string]any{{"message": map[string]any{"content": string(content)}}}, "usage": map[string]any{"prompt_tokens": 10, "completion_tokens": 5}})
	}))
	defer server.Close()
	analyzer := SmartLibraryAnalyzer{APIKey: "key", BaseURL: server.URL, ConfidenceThreshold: .55}
	result, err := analyzer.Analyze(context.Background(), []SmartLibraryImage{{AssetID: "asset_1", MimeType: "image/jpeg", Bytes: []byte("preview")}})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Results) != 1 || result.Results[0].Model != SmartLibraryFallbackModel || result.Results[0].FallbackReason != "confidence_below_evaluated_threshold" {
		t.Fatalf("result=%#v", result)
	}
	if len(models) != 2 || models[0] != SmartLibraryPrimaryModel || models[1] != SmartLibraryFallbackModel {
		t.Fatalf("models=%v", models)
	}
}

func TestSmartLibraryAnalyzerNeverRoutesToPremiumModels(t *testing.T) {
	for _, model := range []string{SmartLibraryPrimaryModel, SmartLibraryFallbackModel, SmartLibraryEmbeddingModel} {
		if model == "openai/gpt-5.6-luna" || model == "openai/gpt-5.6-terra" {
			t.Fatalf("premium model used automatically: %s", model)
		}
	}
}
