package metrics

import (
	"encoding/json"
	"sync"

	"github.com/prometheus/client_golang/prometheus"
)

// maxSocketKinds bounds the message-type label per socket. Message types are
// chosen by the server, but a received frame's type comes from the client, so
// an unbounded label would let any caller mint new time series.
const maxSocketKinds = 48

// traffic holds byte accounting. Request counts alone cannot say which route
// or socket message actually costs bandwidth: one large idle resync can
// outweigh thousands of tiny requests.
type traffic struct {
	responseBytes  *prometheus.CounterVec
	requestBytes   *prometheus.CounterVec
	socketBytes    *prometheus.CounterVec
	socketMessages *prometheus.CounterVec

	mu    sync.Mutex
	kinds map[string]map[string]struct{}
}

func newTraffic(registry *prometheus.Registry) *traffic {
	t := &traffic{
		responseBytes: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "misty_http_response_bytes_total",
			Help: "HTTP response body bytes written, by route pattern and method.",
		}, []string{"route", "method"}),
		requestBytes: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "misty_http_request_bytes_total",
			Help: "HTTP request body bytes declared by Content-Length, by route pattern and method.",
		}, []string{"route", "method"}),
		socketBytes: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "misty_websocket_message_bytes_total",
			Help: "WebSocket payload bytes by socket, direction (sent or received), and message type.",
		}, []string{"socket", "direction", "type"}),
		socketMessages: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "misty_websocket_messages_total",
			Help: "WebSocket messages by socket, direction (sent or received), and message type.",
		}, []string{"socket", "direction", "type"}),
		kinds: map[string]map[string]struct{}{},
	}
	registry.MustRegister(t.responseBytes, t.requestBytes, t.socketBytes, t.socketMessages)
	return t
}

// boundedKind returns kind, or "other" once a socket has used its label budget
// or the kind is not a short identifier.
func (t *traffic) boundedKind(socket, kind string) string {
	if kind == "" || len(kind) > 40 {
		return "other"
	}
	for _, r := range kind {
		if (r < 'a' || r > 'z') && (r < '0' || r > '9') && r != '_' && r != '-' && r != '.' {
			return "other"
		}
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	seen := t.kinds[socket]
	if seen == nil {
		seen = map[string]struct{}{}
		t.kinds[socket] = seen
	}
	if _, ok := seen[kind]; ok {
		return kind
	}
	if len(seen) >= maxSocketKinds {
		return "other"
	}
	seen[kind] = struct{}{}
	return kind
}

// SocketMeter counts messages on one named WebSocket surface. A nil meter is
// valid and records nothing, so callers never need to guard it.
type SocketMeter struct {
	traffic *traffic
	socket  string
}

// Socket returns a meter for the named WebSocket surface.
func (m *Registry) Socket(name string) *SocketMeter {
	if m == nil || m.traffic == nil {
		return nil
	}
	return &SocketMeter{traffic: m.traffic, socket: name}
}

// Sent records one outgoing message of the given type and payload size.
func (s *SocketMeter) Sent(kind string, bytes int) { s.record("sent", kind, bytes) }

// Received records one incoming message of the given type and payload size.
func (s *SocketMeter) Received(kind string, bytes int) { s.record("received", kind, bytes) }

func (s *SocketMeter) record(direction, kind string, bytes int) {
	if s == nil {
		return
	}
	kind = s.traffic.boundedKind(s.socket, kind)
	s.traffic.socketMessages.WithLabelValues(s.socket, direction, kind).Inc()
	if bytes > 0 {
		s.traffic.socketBytes.WithLabelValues(s.socket, direction, kind).Add(float64(bytes))
	}
}

// FrameType reads the top-level "type" field of a JSON message. It is only
// used for labelling; a message without one is reported as "other".
func FrameType(payload []byte) string {
	var frame struct {
		Type string `json:"type"`
	}
	if json.Unmarshal(payload, &frame) != nil {
		return "other"
	}
	return frame.Type
}

func (t *traffic) recordHTTP(route, method string, requestBytes int64, responseBytes int) {
	if requestBytes > 0 {
		t.requestBytes.WithLabelValues(route, method).Add(float64(requestBytes))
	}
	t.responseBytes.WithLabelValues(route, method).Add(float64(responseBytes))
}
