package api

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/kannachi323/misty/server/internal/billingadapter"
)

func TestVoiceAdmissionRejectionClosesCleanly(t *testing.T) {
	for _, scenario := range []struct {
		name    string
		err     error
		code    int
		message string
	}{
		{"allowance", fmt.Errorf("reserve: %w", billingadapter.ErrDenied), websocket.ClosePolicyViolation, "Your account's AI allowance could not cover this voice session. Check your plan and usage in Settings."},
		{"unavailable", billingadapter.ErrUnavailable, websocket.CloseInternalServerErr, "Voice could not check your account's AI allowance. Please try again later."},
		{"internal", errors.New("private backend detail"), websocket.CloseInternalServerErr, "Voice could not check your account's AI allowance. Please try again later."},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			finished := make(chan struct{})
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				defer close(finished)
				upgrader := websocket.Upgrader{}
				conn, err := upgrader.Upgrade(w, r, nil)
				if err != nil {
					t.Error(err)
					return
				}
				defer conn.Close()
				code, message := voiceAdmissionFailure(scenario.err)
				rejectVoiceSetup(conn, code, message)
			}))
			defer server.Close()
			conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
			if err != nil {
				t.Fatal(err)
			}
			defer conn.Close()
			// A WebRTC client may already have sent its offer before admission fails.
			if err := conn.WriteJSON(map[string]string{"type": "rtc.offer", "sdp": "pending offer"}); err != nil {
				t.Fatal(err)
			}
			_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
			var event map[string]string
			if err := conn.ReadJSON(&event); err != nil {
				t.Fatal(err)
			}
			if event["type"] != "error" || event["message"] != scenario.message {
				t.Fatalf("unexpected rejection: %v", event)
			}
			if _, _, err := conn.ReadMessage(); !websocket.IsCloseError(err, scenario.code) {
				t.Fatalf("expected close code %d, got %v", scenario.code, err)
			}
			select {
			case <-finished:
			case <-time.After(3 * time.Second):
				t.Fatal("setup rejection did not finish")
			}
		})
	}
}
