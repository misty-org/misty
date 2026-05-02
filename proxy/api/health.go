package api

import (
	"encoding/json"
	"net/http"
)

type HealthResponse struct {
	OK bool `json:"ok"`
}

func Health() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(HealthResponse{OK: true})
	}
}
