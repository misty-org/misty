package browsersync

import (
	"encoding/json"
	"time"

	"github.com/gorilla/websocket"
	"github.com/kannachi323/misty/server/internal/platform/metrics"
)

// SetMetrics enables per-message byte accounting for the sync socket.
func (s *BrowserSyncService) SetMetrics(registry *metrics.Registry) {
	s.meter = registry.Socket("browser_sync")
}

// writeSyncFrame marshals once so the exact payload size is what gets counted.
func writeSyncFrame(conn *websocket.Conn, meter *metrics.SocketMeter, value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if err = conn.SetWriteDeadline(time.Now().Add(10 * time.Second)); err != nil {
		return err
	}
	if err = conn.WriteMessage(websocket.TextMessage, payload); err != nil {
		return err
	}
	meter.Sent(syncFrameType(value, payload), len(payload))
	return nil
}

func syncFrameType(value any, payload []byte) string {
	if frame, ok := value.(map[string]any); ok {
		if kind, ok := frame["type"].(string); ok {
			return kind
		}
	}
	return metrics.FrameType(payload)
}
