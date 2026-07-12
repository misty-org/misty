package telemetry

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

type SubscriptionProperties struct {
	PlanID          string
	Currency        string
	AmountMinor     int64
	Status          string
	BillingInterval string
}

type Client interface {
	UserRegistered(userID, originatingPlatform, releaseChannel string)
	SubscriptionStarted(userID string, properties SubscriptionProperties)
	SubscriptionRenewed(userID string, properties SubscriptionProperties)
	SubscriptionCanceled(userID string, properties SubscriptionProperties)
	Close(context.Context)
}

type NoopClient struct{}

func (NoopClient) UserRegistered(string, string, string)               {}
func (NoopClient) SubscriptionStarted(string, SubscriptionProperties)  {}
func (NoopClient) SubscriptionRenewed(string, SubscriptionProperties)  {}
func (NoopClient) SubscriptionCanceled(string, SubscriptionProperties) {}
func (NoopClient) Close(context.Context)                               {}

type postHogClient struct {
	token         string
	host          string
	environment   string
	serverVersion string
	http          *http.Client
	queue         chan capture
	done          chan struct{}
	closeOnce     sync.Once
}

type capture struct {
	Event, DistinctID string
	Properties        map[string]any
}

func NewFromEnv() Client {
	environment := normalizedEnvironment(os.Getenv("MISTY_ENVIRONMENT"))
	releaseChannel := strings.TrimSpace(os.Getenv("MISTY_RELEASE_CHANNEL"))
	token := strings.TrimSpace(os.Getenv("POSTHOG_PROJECT_TOKEN"))
	host := strings.TrimRight(strings.TrimSpace(os.Getenv("POSTHOG_HOST")), "/")
	if token == "" || host == "" || (environment != "production" && environment != "staging") || !remoteReleaseChannel(releaseChannel) {
		return NoopClient{}
	}
	parsedHost, err := url.ParseRequestURI(host)
	if err != nil || parsedHost.Scheme != "https" || parsedHost.Host == "" {
		return NoopClient{}
	}
	client := &postHogClient{
		token: token, host: host, environment: environment,
		serverVersion: strings.TrimSpace(os.Getenv("MISTY_SERVER_VERSION")),
		http:          &http.Client{Timeout: 3 * time.Second}, queue: make(chan capture, 256), done: make(chan struct{}),
	}
	go client.run()
	return client
}

func (client *postHogClient) UserRegistered(userID, platform, channel string) {
	properties := map[string]any{"registration_method": "email"}
	if safePlatform(platform) {
		properties["originating_platform"] = platform
	}
	if remoteReleaseChannel(channel) {
		properties["release_channel"] = channel
	}
	client.enqueue("user_registered", userID, properties)
}

func (client *postHogClient) SubscriptionStarted(userID string, properties SubscriptionProperties) {
	client.subscription("subscription_started", userID, properties)
}

func (client *postHogClient) SubscriptionRenewed(userID string, properties SubscriptionProperties) {
	client.subscription("subscription_renewed", userID, properties)
}

func (client *postHogClient) SubscriptionCanceled(userID string, properties SubscriptionProperties) {
	client.subscription("subscription_canceled", userID, properties)
}

func (client *postHogClient) subscription(event, userID string, source SubscriptionProperties) {
	properties := map[string]any{
		"provider": "stripe", "plan_id": safePlan(source.PlanID), "billing_interval": safeInterval(source.BillingInterval),
		"subscription_status": safeStatus(source.Status),
	}
	if len(source.Currency) == 3 {
		properties["currency"] = strings.ToLower(source.Currency)
	}
	if source.AmountMinor >= 0 {
		properties["amount_minor"] = source.AmountMinor
	}
	client.enqueue(event, userID, properties)
}

func (client *postHogClient) enqueue(event, userID string, properties map[string]any) {
	if strings.TrimSpace(userID) == "" {
		return
	}
	properties["environment"] = client.environment
	properties["$geoip_disable"] = true
	if client.serverVersion != "" {
		properties["server_version"] = client.serverVersion
	}
	select {
	case client.queue <- capture{Event: event, DistinctID: userID, Properties: properties}:
	default:
	}
}

func (client *postHogClient) run() {
	defer close(client.done)
	for item := range client.queue {
		client.send(item)
	}
}

func (client *postHogClient) send(item capture) {
	payload, err := json.Marshal(map[string]any{
		"api_key": client.token, "event": item.Event,
		"properties": merge(item.Properties, map[string]any{"distinct_id": item.DistinctID}),
		"timestamp":  time.Now().UTC().Format(time.RFC3339Nano),
	})
	if err != nil {
		return
	}
	request, err := http.NewRequest(http.MethodPost, client.host+"/i/v0/e/", bytes.NewReader(payload))
	if err != nil {
		return
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := client.http.Do(request)
	if err != nil {
		log.Printf("PostHog delivery failed: %s", sanitizedDeliveryError(err))
		return
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		log.Printf("PostHog delivery failed with status %d", response.StatusCode)
	}
}

func (client *postHogClient) Close(ctx context.Context) {
	client.closeOnce.Do(func() { close(client.queue) })
	select {
	case <-client.done:
	case <-ctx.Done():
	}
}

func merge(left, right map[string]any) map[string]any {
	result := make(map[string]any, len(left)+len(right))
	for key, value := range left {
		result[key] = value
	}
	for key, value := range right {
		result[key] = value
	}
	return result
}
func normalizedEnvironment(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "production":
		return "production"
	case "staging":
		return "staging"
	case "test":
		return "test"
	default:
		return "development"
	}
}
func remoteReleaseChannel(value string) bool {
	switch strings.TrimSpace(value) {
	case "internal", "private_alpha", "private_beta", "public_beta", "production":
		return true
	default:
		return false
	}
}
func safePlatform(value string) bool {
	switch value {
	case "windows", "macos", "linux", "android", "ios":
		return true
	default:
		return false
	}
}
func safePlan(value string) string {
	switch value {
	case "personal", "pro", "max":
		return value
	default:
		return "unknown"
	}
}
func safeInterval(value string) string {
	switch value {
	case "monthly", "yearly", "lifetime":
		return value
	default:
		return "other"
	}
}
func safeStatus(value string) string {
	switch value {
	case "trialing", "active", "past_due", "canceled", "expired":
		return value
	default:
		return "canceled"
	}
}
func sanitizedDeliveryError(_ error) string { return "network request failed" }
