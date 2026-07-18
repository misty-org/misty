package api

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestVerifySlackRequestRejectsReplayAndTampering(t *testing.T) {
	secret := "test-signing-secret"
	raw := []byte(`{"type":"event_callback","event_id":"Ev1"}`)
	now := time.Date(2026, 7, 18, 12, 0, 0, 0, time.UTC)
	timestamp := strconv.FormatInt(now.Unix(), 10)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte("v0:" + timestamp + ":"))
	_, _ = mac.Write(raw)
	headers := http.Header{}
	headers.Set("X-Slack-Request-Timestamp", timestamp)
	headers.Set("X-Slack-Signature", "v0="+hex.EncodeToString(mac.Sum(nil)))
	if !verifySlackRequest(raw, headers, now, secret) {
		t.Fatal("valid Slack signature was rejected")
	}
	if verifySlackRequest([]byte(`{"tampered":true}`), headers, now, secret) {
		t.Fatal("tampered Slack payload was accepted")
	}
	if verifySlackRequest(raw, headers, now.Add(6*time.Minute), secret) {
		t.Fatal("replayed Slack request was accepted")
	}
}

func TestSlackURLVerificationEchoesSignedChallenge(t *testing.T) {
	secret := "test-signing-secret"
	t.Setenv("SLACK_SIGNING_SECRET", secret)
	raw := `{"type":"url_verification","challenge":"misty-slack-challenge"}`
	timestamp := strconv.FormatInt(time.Now().UTC().Unix(), 10)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte("v0:" + timestamp + ":" + raw))
	request := httptest.NewRequest(http.MethodPost, "/api/provider-callbacks/slack-events", strings.NewReader(raw))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Slack-Request-Timestamp", timestamp)
	request.Header.Set("X-Slack-Signature", "v0="+hex.EncodeToString(mac.Sum(nil)))
	recorder := httptest.NewRecorder()

	(&SpacesService{}).SlackEventsCallback().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", recorder.Code, http.StatusOK, recorder.Body.String())
	}
	if got, want := recorder.Body.String(), "misty-slack-challenge"; got != want {
		t.Fatalf("challenge body = %q, want %q", got, want)
	}
	if got := recorder.Header().Get("Content-Type"); !strings.HasPrefix(got, "text/plain") {
		t.Fatalf("content type = %q, want text/plain", got)
	}
}

func TestVerifyNotionRequestUsesRawBodyHMAC(t *testing.T) {
	secret := "test-notion-verification-token"
	raw := []byte(`{"id":"event-1","type":"page.content_updated"}`)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(raw)
	signature := "sha256=" + hex.EncodeToString(mac.Sum(nil))
	if !verifyNotionRequest(raw, signature, secret) {
		t.Fatal("valid Notion signature was rejected")
	}
	if verifyNotionRequest(append(raw, '\n'), signature, secret) {
		t.Fatal("modified Notion body was accepted")
	}
	if verifyNotionRequest(raw, signature, "") {
		t.Fatal("Notion signature was accepted without a configured secret")
	}
}
