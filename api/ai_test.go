package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kannachi323/misty/server/ai"
	"github.com/kannachi323/misty/server/db"
)

func TestAIHandlersRequireAuthentication(t *testing.T) {
	service := NewAIService(&db.Database{}, ai.NewService(nil, nil))
	tests := []struct {
		name    string
		handler http.HandlerFunc
		method  string
		path    string
	}{
		{name: "create", handler: service.CreateSession(), method: http.MethodPost, path: "/ai/sessions"},
		{name: "status", handler: service.Status(), method: http.MethodGet, path: "/ai/status"},
		{name: "message", handler: service.SendMessage(), method: http.MethodPost, path: "/ai/sessions/s/messages"},
		{name: "events", handler: service.Events(), method: http.MethodGet, path: "/ai/sessions/s/events"},
		{name: "tool-results", handler: service.SubmitToolResults(), method: http.MethodPost, path: "/ai/sessions/s/tool-results"},
		{name: "cancel", handler: service.Cancel(), method: http.MethodPost, path: "/ai/sessions/s/cancel"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, nil)
			rec := httptest.NewRecorder()
			tt.handler.ServeHTTP(rec, req)
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("%s status = %d, want %d", tt.name, rec.Code, http.StatusUnauthorized)
			}
		})
	}
}
