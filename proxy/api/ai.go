package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/kannachi323/misty/proxy/core/ai"
)

func AskFileContext(svc *ai.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if svc == nil || !svc.Ready() {
			http.Error(w, "Misty AI is not configured on the proxy", http.StatusServiceUnavailable)
			return
		}

		var req ai.FileContextRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		defer r.Body.Close()

		req.Prompt = strings.TrimSpace(req.Prompt)
		if req.Prompt == "" {
			http.Error(w, "prompt is required", http.StatusBadRequest)
			return
		}

		reply, err := svc.GenerateFileContextReply(r.Context(), req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"reply": reply,
			"model": svc.Model(),
		})
	}
}
