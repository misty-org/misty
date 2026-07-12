package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/kannachi323/misty/server/agent"
	"github.com/kannachi323/misty/server/db"
)

func TestAIHandlersRequireAuthentication(t *testing.T) {
	service := NewAIService(&db.Database{}, agent.NewService(nil, nil))
	tests := []struct {
		name    string
		handler http.HandlerFunc
		method  string
		path    string
	}{
		{name: "create", handler: service.CreateSession(), method: http.MethodPost, path: "/ai/sessions"},
		{name: "status", handler: service.Status(), method: http.MethodGet, path: "/ai/status"},
		{name: "complete", handler: service.Complete(), method: http.MethodPost, path: "/ai/complete"},
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

func TestWriteAIRateLimitIsStructuredAndDoesNotSuggestAutomaticRetry(t *testing.T) {
	recorder := httptest.NewRecorder()
	writeAIRateLimit(recorder, 30*time.Second)
	if recorder.Code != http.StatusTooManyRequests || recorder.Header().Get("Retry-After") != "30" {
		t.Fatalf("status=%d retry-after=%q", recorder.Code, recorder.Header().Get("Retry-After"))
	}
	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["code"] != "rate_limited" || payload["retry_after_seconds"] != float64(30) {
		t.Fatalf("payload = %#v", payload)
	}
}

func TestWriteAIErrorReturnsCanceledWithoutProviderDetails(t *testing.T) {
	recorder := httptest.NewRecorder()
	writeAIError(recorder, context.Canceled)
	if recorder.Code != 499 || !strings.Contains(recorder.Body.String(), `"code":"request_canceled"`) {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestWriteAIErrorReturnsStructuredCreditsExhausted(t *testing.T) {
	recorder := httptest.NewRecorder()
	writeAIError(recorder, agent.CreditsExhaustedError{Required: 25, Available: 10})
	if recorder.Code != http.StatusPaymentRequired {
		t.Fatalf("status = %d", recorder.Code)
	}
	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["code"] != "credits_exhausted" || payload["top_up_available"] != true {
		t.Fatalf("payload = %#v", payload)
	}
}

func TestMikaTierFollowsSubscriptionTier(t *testing.T) {
	tests := map[db.Tier]agent.MikaTier{
		db.TierBasic: agent.MikaLow,
		db.TierPro:   agent.MikaMed,
		db.TierMax:   agent.MikaHigh,
	}
	for subscription, want := range tests {
		if got := mikaTierForLicenseTier(subscription); got != want {
			t.Fatalf("mikaTierForLicenseTier(%q) = %q, want %q", subscription, got, want)
		}
	}
}
