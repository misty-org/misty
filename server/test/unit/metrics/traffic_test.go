package metrics

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	. "github.com/kannachi323/misty/server/internal/platform/metrics"

	"github.com/go-chi/chi/v5"
)

func TestResponseBytesAreCountedPerRoute(t *testing.T) {
	registry := New()
	router := chi.NewRouter()
	router.Use(registry.Middleware)
	router.Get("/spaces/{spaceID}", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("0123456789"))
	})
	for _, id := range []string{"a", "b", "c"} {
		router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/spaces/"+id, nil))
	}
	body := scrape(t, registry, "secret-token")
	want := `misty_http_response_bytes_total{method="GET",route="/spaces/{spaceID}"} 30`
	if !strings.Contains(body, want) {
		t.Fatalf("scrape is missing %q:\n%s", want, body)
	}
}

func TestSocketMessagesAreCountedByTypeAndDirection(t *testing.T) {
	registry := New()
	meter := registry.Socket("browser_sync")
	meter.Sent("presence", 100)
	meter.Sent("presence", 50)
	meter.Received("heartbeat", 20)
	body := scrape(t, registry, "secret-token")
	for _, want := range []string{
		`misty_websocket_message_bytes_total{direction="sent",socket="browser_sync",type="presence"} 150`,
		`misty_websocket_messages_total{direction="sent",socket="browser_sync",type="presence"} 2`,
		`misty_websocket_message_bytes_total{direction="received",socket="browser_sync",type="heartbeat"} 20`,
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("scrape is missing %q:\n%s", want, body)
		}
	}
}

// A client chooses the type of each frame it sends, so it must not be able to
// mint unbounded label values.
func TestClientChosenSocketTypesAreBounded(t *testing.T) {
	registry := New()
	meter := registry.Socket("realtime")
	for i := 0; i < 500; i++ {
		meter.Received(fmt.Sprintf("probe_%d", i), 1)
	}
	meter.Received("Not An Identifier!", 1)
	body := scrape(t, registry, "secret-token")
	if strings.Count(body, `misty_websocket_messages_total{direction="received",socket="realtime"`) > 49 {
		t.Fatalf("socket type labels were not bounded")
	}
	if !strings.Contains(body, `type="other"`) {
		t.Fatalf("overflow types were not folded into other")
	}
}

func TestNilSocketMeterIsSafe(t *testing.T) {
	var registry *Registry
	registry.Socket("x").Sent("y", 1)
}

func TestFrameTypeReadsTopLevelType(t *testing.T) {
	if got := FrameType([]byte(`{"type":"event","event":{"type":"nested"}}`)); got != "event" {
		t.Fatalf("FrameType = %q", got)
	}
	if got := FrameType([]byte(`not json`)); got != "other" {
		t.Fatalf("FrameType = %q", got)
	}
}
