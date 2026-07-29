package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

const healthCacheTTL = 15 * time.Second

type healthCheck struct {
	Status     string `json:"status"`
	Mode       string `json:"mode"`
	Critical   bool   `json:"critical"`
	Message    string `json:"message,omitempty"`
	DurationMS int64  `json:"duration_ms,omitempty"`
}

type healthSnapshot struct {
	Status         string                 `json:"status"`
	Version        string                 `json:"version"`
	Environment    string                 `json:"environment"`
	ReleaseChannel string                 `json:"release_channel"`
	GeneratedAt    time.Time              `json:"generated_at"`
	UptimeSeconds  int64                  `json:"uptime_seconds"`
	Checks         map[string]healthCheck `json:"checks"`
}

type healthMonitor struct {
	server    *Server
	startedAt time.Time
	mu        sync.Mutex
	cached    healthSnapshot
	status    int
	expiresAt time.Time
}

func newHealthMonitor(server *Server) *healthMonitor {
	return &healthMonitor{server: server, startedAt: time.Now().UTC()}
}

func (monitor *healthMonitor) Handler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		snapshot, status := monitor.snapshot(r.Context())
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(snapshot)
	}
}

func (monitor *healthMonitor) snapshot(parent context.Context) (healthSnapshot, int) {
	monitor.mu.Lock()
	defer monitor.mu.Unlock()
	if time.Now().UTC().Before(monitor.expiresAt) {
		return monitor.cached, monitor.status
	}
	ctx, cancel := context.WithTimeout(parent, 6*time.Second)
	defer cancel()
	monitor.cached, monitor.status = monitor.evaluate(ctx)
	monitor.expiresAt = time.Now().UTC().Add(healthCacheTTL)
	return monitor.cached, monitor.status
}

func (monitor *healthMonitor) evaluate(ctx context.Context) (healthSnapshot, int) {
	now := time.Now().UTC()
	checks := map[string]healthCheck{}
	databaseOK := false
	checks["database"] = activeHealthCheck(ctx, true, func(ctx context.Context) error {
		if monitor.server == nil || monitor.server.Database == nil || monitor.server.Database.Conn == nil {
			return errors.New("database is not started")
		}
		if err := monitor.server.Database.Conn.PingContext(ctx); err != nil {
			return err
		}
		databaseOK = true
		return nil
	})
	checks["library_storage"] = activeHealthCheck(ctx, true, func(ctx context.Context) error {
		if monitor.server == nil || monitor.server.LibraryStore == nil {
			return errors.New("Library storage is unavailable")
		}
		return monitor.server.LibraryStore.Health(ctx)
	})
	checks["realtime"] = activeHealthCheck(ctx, true, func(context.Context) error {
		if monitor.server == nil || monitor.server.Realtime == nil {
			return errors.New("realtime is unavailable")
		}
		return monitor.server.Realtime.Health()
	})

	checks["public_api"] = publicAPIConfigurationCheck()
	agentGatewayCheck := environmentConfigurationCheck("AI_GATEWAY_API_KEY|VERCEL_OIDC_TOKEN")
	checks["agent_gateway"] = agentGatewayCheck
	// Pre-rename key, still emitted so any external dashboard or alert watching
	// it keeps reporting while it is repointed at agent_gateway.
	checks["mika"] = agentGatewayCheck
	checks["email"] = environmentConfigurationCheck("MAILJET_API_KEY", "MAILJET_SECRET_KEY", "MAILJET_FROM_EMAIL")
	checks["billing"] = environmentConfigurationCheck(
		"STRIPE_SECRET_KEY",
		"STRIPE_WEBHOOK_SECRET",
		"STRIPE_PRICE_PRO_MONTHLY",
		"STRIPE_PRICE_PRO_YEARLY",
		"STRIPE_PRICE_MAX_MONTHLY",
		"STRIPE_PRICE_MAX_YEARLY",
		"STRIPE_CHECKOUT_SUCCESS_URL",
		"STRIPE_CHECKOUT_CANCEL_URL",
		"STRIPE_PORTAL_RETURN_URL",
	)
	checks["google"] = environmentConfigurationCheck("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET")
	checks["slack"] = environmentConfigurationCheck("SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET", "SLACK_SIGNING_SECRET")
	checks["notion"] = environmentConfigurationCheck("NOTION_CLIENT_ID", "NOTION_CLIENT_SECRET", "NOTION_WEBHOOK_VERIFICATION_TOKEN")
	checks["discord"] = monitor.discordHealthCheck(ctx, databaseOK)

	overall, status := summarizeHealth(checks)
	version := strings.TrimSpace(os.Getenv("MISTY_SERVER_VERSION"))
	if version == "" {
		version = "development"
	}
	environment := strings.TrimSpace(os.Getenv("MISTY_ENVIRONMENT"))
	if environment == "" {
		environment = "development"
	}
	release := strings.TrimSpace(os.Getenv("MISTY_RELEASE_CHANNEL"))
	if release == "" {
		release = environment
	}
	return healthSnapshot{
		Status: overall, Version: version, Environment: environment,
		ReleaseChannel: release, GeneratedAt: now,
		UptimeSeconds: int64(now.Sub(monitor.startedAt).Seconds()), Checks: checks,
	}, status
}

func activeHealthCheck(ctx context.Context, critical bool, check func(context.Context) error) healthCheck {
	started := time.Now()
	result := healthCheck{Status: "ok", Mode: "active", Critical: critical}
	if err := check(ctx); err != nil {
		result.Status = "unavailable"
		result.Message = "dependency check failed"
	}
	result.DurationMS = time.Since(started).Milliseconds()
	return result
}

func environmentConfigurationCheck(groups ...string) healthCheck {
	result := healthCheck{Status: "ready", Mode: "configuration", Critical: false}
	for _, group := range groups {
		configured := false
		for _, key := range strings.Split(group, "|") {
			if strings.TrimSpace(os.Getenv(key)) != "" {
				configured = true
				break
			}
		}
		if !configured {
			result.Status = "unconfigured"
			result.Message = "configuration incomplete"
			return result
		}
	}
	return result
}

func publicAPIConfigurationCheck() healthCheck {
	result := healthCheck{Status: "ready", Mode: "configuration", Critical: false}
	value := strings.TrimSpace(os.Getenv("MISTY_PUBLIC_API_URL"))
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		result.Status, result.Message = "unconfigured", "configuration incomplete"
		return result
	}
	if strings.EqualFold(strings.TrimSpace(os.Getenv("MISTY_ENVIRONMENT")), "production") && parsed.Scheme != "https" {
		result.Status, result.Message = "degraded", "production API base must use HTTPS"
	}
	return result
}

func (monitor *healthMonitor) discordHealthCheck(ctx context.Context, databaseOK bool) healthCheck {
	configured := environmentConfigurationCheck("DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_BOT_TOKEN")
	if configured.Status != "ready" || !databaseOK || monitor.server == nil || monitor.server.Database == nil {
		return configured
	}
	state, err := monitor.server.Database.ProviderGatewayState(ctx, "discord")
	if err != nil {
		return healthCheck{Status: "unavailable", Mode: "active", Critical: false, Message: "gateway state unavailable"}
	}
	if state.Status != "connected" || state.LastHeartbeatAt == nil || state.LastHeartbeatAt.Before(time.Now().UTC().Add(-2*time.Minute)) {
		return healthCheck{Status: "degraded", Mode: "active", Critical: false, Message: "gateway disconnected or stale"}
	}
	return healthCheck{Status: "ok", Mode: "active", Critical: false}
}

func summarizeHealth(checks map[string]healthCheck) (string, int) {
	overall := "ok"
	for _, check := range checks {
		if check.Critical && check.Status != "ok" {
			return "unavailable", http.StatusServiceUnavailable
		}
		if check.Status != "ok" && check.Status != "ready" {
			overall = "degraded"
		}
	}
	return overall, http.StatusOK
}
