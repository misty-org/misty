package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAgentRoutesRequireAuthentication(t *testing.T) {
	disableJournalCollabForTest(t)
	t.Setenv("PASSWORD_RESET_URL", "http://localhost:5173/reset")
	t.Setenv("PASSWORD_RESET_START_URL", "http://localhost:8080/auth/reset/start")
	t.Setenv("MAILJET_API_KEY", "")
	t.Setenv("MAILJET_SECRET_KEY", "")
	t.Setenv("MAILJET_FROM_EMAIL", "")
	t.Setenv("MISTY_DEVICE_JOBS_ENABLED", "true")
	server, err := CreateServer()
	if err != nil {
		t.Fatal(err)
	}
	if err := server.MountHandlers(); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{
		"/api/devices",
		"/api/agents",
		"/api/agents/jobs",
		"/api/agents/catalog",
		"/api/ai/models",
		"/api/agent-conversations",
		"/api/spaces/space-1/tasks",
		"/api/spaces/space-1/calendar/events",
		"/api/spaces/space-1/calendar/sources",
	} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		server.Router.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("GET %s status = %d, want 401", path, rec.Code)
		}
	}
}
