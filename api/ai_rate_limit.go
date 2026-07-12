package api

import (
	"sync"
	"time"
)

const (
	aiProviderRequestsPerMinute = 12
	aiProviderRequestsPerHour   = 120
	aiSessionsPerHour           = 20
	aiMaxConcurrentPerUser      = 1
	aiGlobalRequestsPerMinute   = 60
	aiGlobalRequestsPerHour     = 1000
	aiGlobalMaxConcurrent       = 8
)

type AIRequestGuard struct {
	mu            sync.Mutex
	now           func() time.Time
	perMinute     *SlidingWindowLimiter
	perHour       *SlidingWindowLimiter
	globalMinute  *SlidingWindowLimiter
	globalHour    *SlidingWindowLimiter
	sessions      *SlidingWindowLimiter
	inFlight      map[string]int
	inFlightTotal int
	maxInFlight   int
}

func NewAIRequestGuard() *AIRequestGuard {
	return &AIRequestGuard{
		now:          time.Now,
		perMinute:    NewSlidingWindowLimiter(aiProviderRequestsPerMinute, time.Minute),
		perHour:      NewSlidingWindowLimiter(aiProviderRequestsPerHour, time.Hour),
		globalMinute: NewSlidingWindowLimiter(aiGlobalRequestsPerMinute, time.Minute),
		globalHour:   NewSlidingWindowLimiter(aiGlobalRequestsPerHour, time.Hour),
		sessions:     NewSlidingWindowLimiter(aiSessionsPerHour, time.Hour),
		inFlight:     make(map[string]int),
		maxInFlight:  aiMaxConcurrentPerUser,
	}
}

// AcquireProviderCall admits at most one active provider request per user and
// enforces both burst and sustained limits. Rejected concurrent attempts do not
// consume the rate budget and are never queued or retried.
func (g *AIRequestGuard) AcquireProviderCall(userID string) (release func(), retryAfter time.Duration, allowed bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.inFlight[userID] >= g.maxInFlight {
		return nil, time.Second, false
	}
	if g.inFlightTotal >= aiGlobalMaxConcurrent {
		return nil, time.Second, false
	}
	now := g.now()
	if ok, retry := g.perMinute.Allow(userID, now); !ok {
		return nil, retry, false
	}
	if ok, retry := g.perHour.Allow(userID, now); !ok {
		return nil, retry, false
	}
	if ok, retry := g.globalMinute.Allow("global", now); !ok {
		return nil, retry, false
	}
	if ok, retry := g.globalHour.Allow("global", now); !ok {
		return nil, retry, false
	}
	g.inFlight[userID]++
	g.inFlightTotal++
	return func() {
		g.mu.Lock()
		if g.inFlight[userID] <= 1 {
			delete(g.inFlight, userID)
		} else {
			g.inFlight[userID]--
		}
		if g.inFlightTotal > 0 {
			g.inFlightTotal--
		}
		g.mu.Unlock()
	}, 0, true
}

func (g *AIRequestGuard) AllowSession(userID string) (bool, time.Duration) {
	return g.sessions.Allow(userID, g.now())
}
