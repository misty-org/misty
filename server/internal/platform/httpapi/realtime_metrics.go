package api

import "github.com/kannachi323/misty/server/internal/platform/metrics"

// SetMetrics enables per-message byte accounting for the realtime socket.
func (s *RealtimeService) SetMetrics(registry *metrics.Registry) {
	s.meter = registry.Socket("realtime")
}
