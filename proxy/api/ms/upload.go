package ms

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/kannachi323/misty/proxy/core/ms"
)

func GetUploadSession() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req UploadRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Failed to decode request body", http.StatusBadRequest)
			return;
		}

		url := fmt.Sprintf("%s/drives/%s/items/%s:/%s:/createUploadSession",
			ms.GetConfig().GraphBase, req.DriveID, req.ParentID, req.FileName)

		payload, _ := json.Marshal(map[string]interface{}{
			"item": map[string]interface{}{
				"@microsoft.graph.conflictBehavior": "rename",
				"name": req.FileName,
			},
		})
		graphReq, err := http.NewRequest(http.MethodPost, url, bytes.NewBuffer(payload))
		if err != nil {
			http.Error(w, "Failed to create request", http.StatusInternalServerError)
			return;
		}
		graphReq.Header.Set("Authorization", r.Header.Get("Authorization"))
		graphReq.Header.Set("Content-Type", "application/json")

		graphRes, err := http.DefaultClient.Do(graphReq)
		if err != nil {
			http.Error(w, "Failed to make request to Microsoft Graph", http.StatusInternalServerError)
			return;
		}
		defer graphRes.Body.Close()

		if graphRes.StatusCode != http.StatusOK {
			http.Error(w, "Failed to create upload session", http.StatusInternalServerError)
			return;
		}

		var session UploadSession
		if err := json.NewDecoder(graphRes.Body).Decode(&session); err != nil {
			http.Error(w, "Failed to decode response", http.StatusInternalServerError)
			return;
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(session)
	}
}