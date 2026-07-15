package agent

import (
	"errors"
	"testing"
)

type namedTestProvider struct {
	provider string
	model    string
	text     string
	err      error
}

func (provider namedTestProvider) ProviderName() string { return provider.provider }
func (provider namedTestProvider) ModelName() string    { return provider.model }
func (provider namedTestProvider) Next(ModelRequest) (ModelResponse, error) {
	return ModelResponse{Text: provider.text, Usage: ModelUsage{InputTokens: 10, OutputTokens: 5}}, provider.err
}

type recordingUsageMeter struct {
	userID   string
	key      string
	provider string
	model    string
	releases int
}

func (meter *recordingUsageMeter) Reserve(userID string, key string, _ string, provider, model string, _, _ int64) (*UsageReservation, error) {
	meter.userID = userID
	meter.key = key
	meter.provider = provider
	meter.model = model
	return &UsageReservation{ID: "reservation", ReservedCredits: 10}, nil
}

func TestAgentJobSessionBillsRequesterWithJobIdempotency(t *testing.T) {
	meter := &recordingUsageMeter{}
	service := NewService(nil, namedTestProvider{provider: "gateway", model: "model", text: "done"}, WithUsageMeter(meter))
	session := service.CreateSessionForJob("owner-user", "requester-user", "job_123")
	if err := service.SendMessage(session.ID, "owner-user", AgentMessageRequest{UserMessage: "summarize"}); err != nil {
		t.Fatal(err)
	}
	if meter.userID != "requester-user" {
		t.Fatalf("job billed %q, want requester", meter.userID)
	}
	if meter.key != "agent-job:job_123:1" {
		t.Fatalf("job billing key = %q", meter.key)
	}
}

func (*recordingUsageMeter) Settle(*UsageReservation, string, string, string, string, ModelUsage) (UsageSettlement, error) {
	return UsageSettlement{CreditsUsed: 2, CreditsRemaining: 98}, nil
}

func (meter *recordingUsageMeter) Release(*UsageReservation) error {
	meter.releases++
	return nil
}

func TestMikaRouterUsesTierWithoutChangingBillingIdentity(t *testing.T) {
	router := NewMikaProviderRouter(
		namedTestProvider{provider: "low-provider", model: "low-model", text: "low"},
		namedTestProvider{provider: "med-provider", model: "med-model", text: "med"},
		namedTestProvider{provider: "high-provider", model: "high-model", text: "high"},
	)
	meter := &recordingUsageMeter{}
	service := NewService(nil, router, WithUsageMeter(meter))

	text, usage, err := service.CompleteWithTier("user", "hello", "automation_ai", MikaHigh)
	if err != nil {
		t.Fatal(err)
	}
	if text != "high" || usage.CreditsUsed != 2 {
		t.Fatalf("completion = %q, usage = %#v", text, usage)
	}
	if meter.provider != "high-provider" || meter.model != "high-model" {
		t.Fatalf("billing identity = %s/%s", meter.provider, meter.model)
	}
	if provider, model := router.ProviderName(), router.ModelName(); provider != "misty" || model != string(MikaLow) {
		t.Fatalf("public router identity = %s/%s", provider, model)
	}
}

func TestProviderErrorsUseMikaBrandingInSessionEvents(t *testing.T) {
	meter := &recordingUsageMeter{}
	service := NewService(nil, NewMikaProviderRouter(
		namedTestProvider{err: errors.New("openai secret provider failure")}, nil, nil,
	), WithUsageMeter(meter))
	session := service.CreateSession("user")
	if err := service.SendMessageWithTier(session.ID, "user", AgentMessageRequest{UserMessage: "hello"}, MikaLow); err != nil {
		t.Fatal(err)
	}
	events, err := service.Events(session.ID, "user", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].Message != "Mika could not complete this request." {
		t.Fatalf("events = %#v", events)
	}
	if meter.releases != 1 {
		t.Fatalf("released reservations = %d, want 1", meter.releases)
	}
}

func TestCompletionProviderErrorReleasesReservation(t *testing.T) {
	meter := &recordingUsageMeter{}
	service := NewService(nil, NewMikaProviderRouter(
		namedTestProvider{provider: ProviderVercelAI, model: "private-model", err: errors.New("status 429")}, nil, nil,
	), WithUsageMeter(meter))

	_, _, err := service.CompleteWithTier("user", "hello", "automation_ai", MikaLow)
	if err == nil || err.Error() != "status 429" {
		t.Fatalf("error = %v, want gateway 429", err)
	}
	var exhausted CreditsExhaustedError
	if errors.As(err, &exhausted) {
		t.Fatalf("gateway 429 was misclassified as credits exhausted: %v", err)
	}
	if meter.releases != 1 {
		t.Fatalf("released reservations = %d, want 1", meter.releases)
	}
}

func TestNormalizeMikaTierDefaultsToLow(t *testing.T) {
	if got := NormalizeMikaTier("unknown"); got != MikaLow {
		t.Fatalf("NormalizeMikaTier() = %q", got)
	}
}
