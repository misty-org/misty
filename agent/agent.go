package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
)

type Service struct {
	store    *SessionStore
	provider ModelProvider
	policy   PermissionPolicy
	meter    UsageMeter
}

type ToolExecutor func(context.Context, ToolRequest) (json.RawMessage, error)

type ToolCompletion struct {
	Text      string
	Citations []AgentCitation
	ToolCalls int
}

// MaxToolRounds bounds how many tool round trips one automated run may make.
// Generous for real work, finite so a runaway loop cannot bill forever.
const MaxToolRounds = 12

// ErrToolRoundLimit is returned when a run exceeds MaxToolRounds.
var ErrToolRoundLimit = errors.New("agent run exceeded its tool round limit")

// CompleteWithToolsContext runs the same Mika session/tool protocol used by
// interactive chat, but dispatches each manifest-authorized request through a
// server-owned executor. This is the bridge used by automated Agent tasks;
// finite provider/tool limits remain enforced by the Session service.
func (s *Service) CompleteWithToolsContext(ctx context.Context, userID, billingUserID, prompt string, tier MikaTier, manifest ToolManifest, execute ToolExecutor) (ToolCompletion, error) {
	if execute == nil || len(manifest.Tools) == 0 {
		text, _, err := s.CompleteWithTierContext(ctx, billingUserID, prompt, "automation_ai", tier)
		return ToolCompletion{Text: text}, err
	}
	session := s.CreateSessionWithBilling(userID, billingUserID)
	defer func() { _ = s.Forget(session.ID, userID) }()
	if err := s.SendMessageWithTierContext(ctx, session.ID, userID, AgentMessageRequest{Mode: ModeFull, UserMessage: prompt, Capabilities: manifest}, tier); err != nil {
		return ToolCompletion{}, err
	}
	after := int64(0)
	completion := ToolCompletion{}
	// Each round trip is another paid model call. Without a cap, a model that
	// keeps asking for tools loops until the caller disconnects, so one request
	// can bill indefinitely.
	for round := 0; ; round++ {
		if round >= MaxToolRounds {
			return ToolCompletion{}, ErrToolRoundLimit
		}
		if ctx.Err() != nil {
			return ToolCompletion{}, ctx.Err()
		}
		events, err := s.Events(session.ID, userID, after)
		if err != nil {
			return ToolCompletion{}, err
		}
		requests := []ToolRequest{}
		for _, event := range events {
			if event.Sequence > after {
				after = event.Sequence
			}
			switch event.Type {
			case EventError:
				return ToolCompletion{}, errors.New(event.Message)
			case EventAssistantMessage:
				if strings.TrimSpace(event.Text) != "" {
					completion.Text = strings.TrimSpace(event.Text)
					completion.Citations = append([]AgentCitation(nil), event.Citations...)
				}
			case EventToolRequest:
				requests = append(requests, event.ToolRequests...)
			}
		}
		if len(requests) == 0 {
			if completion.Text == "" {
				return ToolCompletion{}, errors.New("Mika returned neither a result nor a tool request")
			}
			return completion, nil
		}
		results := make([]ToolResult, 0, len(requests))
		for _, request := range requests {
			completion.ToolCalls++
			result, executeErr := execute(ctx, request)
			item := ToolResult{RequestID: request.ID, Name: request.Name, OK: executeErr == nil, Result: result}
			if executeErr != nil {
				item.Error = executeErr.Error()
			}
			results = append(results, item)
		}
		if err := s.SubmitToolResultsWithTierContext(ctx, session.ID, userID, results, tier); err != nil {
			return ToolCompletion{}, err
		}
	}
}

func (s *Service) Complete(userID, prompt, meterName string) (string, UsageSettlement, error) {
	return s.CompleteWithTier(userID, prompt, meterName, MikaLow)
}

func (s *Service) CompleteWithTier(userID, prompt, meterName string, tier MikaTier) (string, UsageSettlement, error) {
	return s.CompleteWithTierContext(context.Background(), userID, prompt, meterName, tier)
}

func (s *Service) CompleteWithTierContext(ctx context.Context, userID, prompt, meterName string, tier MikaTier) (string, UsageSettlement, error) {
	prompt = strings.TrimSpace(prompt)
	if prompt == "" {
		return "", UsageSettlement{}, ErrInvalidRequest("prompt is required")
	}
	if len(prompt) > MaxUserMessageBytes {
		return "", UsageSettlement{}, ErrInvalidRequest("prompt is too large")
	}
	tier = NormalizeMikaTier(tier)
	request := ModelRequest{SessionID: uuid.NewString(), UserID: userID, MikaTier: tier, Mode: ModeAsk, Messages: []Message{{Role: "user", Content: prompt}}}
	selectedProvider := resolveMikaProvider(s.provider, tier)
	provider, model := providerStatus(selectedProvider)
	idempotencyKey := "completion:" + request.SessionID
	var reservation *UsageReservation
	var err error
	if s.meter != nil && provider != ProviderMock {
		reservation, err = s.meter.Reserve(userID, idempotencyKey, meterName, provider, model, estimateRequestTokens(request), MaxModelOutputTokens)
		if err != nil {
			return "", UsageSettlement{}, err
		}
	}
	response, err := nextProvider(ctx, selectedProvider, request)
	if err != nil {
		if reservation != nil {
			_ = s.meter.Release(reservation)
		}
		if !errors.Is(err, context.Canceled) {
			log.Printf("Mika completion provider request failed for tier %s: %v", tier, err)
		}
		return "", UsageSettlement{}, err
	}
	settlement := UsageSettlement{}
	if reservation != nil {
		settlement, err = s.meter.Settle(reservation, idempotencyKey+":settle", meterName, provider, model, response.Usage)
		if err != nil {
			_ = s.meter.Release(reservation)
			return "", UsageSettlement{}, err
		}
	}
	return response.Text, settlement, nil
}

type ServiceOption func(*Service)

func WithUsageMeter(meter UsageMeter) ServiceOption {
	return func(service *Service) { service.meter = meter }
}

func NewService(store *SessionStore, provider ModelProvider, options ...ServiceOption) *Service {
	if store == nil {
		store = NewSessionStore(0)
	}
	if provider == nil {
		provider = MockProvider{}
	}
	service := &Service{
		store:    store,
		provider: provider,
		policy:   PermissionPolicy{},
	}
	for _, option := range options {
		option(service)
	}
	return service
}

func (s *Service) Store() *SessionStore {
	return s.store
}

func (s *Service) ProviderStatus() (string, string) {
	return s.ProviderStatusForTier(MikaLow)
}

func (s *Service) ProviderStatusForTier(tier MikaTier) (string, string) {
	return providerStatus(resolveMikaProvider(s.provider, tier))
}

func (s *Service) MikaConfigured(tier MikaTier) bool {
	provider, _ := s.ProviderStatusForTier(tier)
	return provider != ProviderMock
}

func providerStatus(provider ModelProvider) (string, string) {
	if info, ok := provider.(ProviderInfo); ok {
		return info.ProviderName(), info.ModelName()
	}
	return ProviderMock, "mock"
}

func (s *Service) CreateSession(userID string) *Session {
	return s.store.Create(userID)
}

func (s *Service) CreateSessionWithBilling(userID, billingUserID string) *Session {
	return s.store.CreateWithBilling(userID, billingUserID)
}

func (s *Service) CreateSessionForJob(userID, billingUserID, jobID string) *Session {
	return s.store.CreateWithBillingScope(userID, billingUserID, "agent-job:"+jobID)
}

// SessionBillingScope exposes only the server-owned billing scope associated
// with a session. API adapters use it to bind short-lived document attachments
// to the exact durable job that created the conversation.
func (s *Service) SessionBillingScope(sessionID, userID string) (string, error) {
	var scope string
	err := s.store.WithSession(sessionID, userID, func(session *Session) error {
		scope = session.BillingScope
		return nil
	})
	return scope, err
}

func (s *Service) SendMessage(sessionID, userID string, request AgentMessageRequest) error {
	return s.SendMessageWithTier(sessionID, userID, request, MikaLow)
}

func (s *Service) SendMessageWithTier(sessionID, userID string, request AgentMessageRequest, tier MikaTier) error {
	return s.SendMessageWithTierContext(context.Background(), sessionID, userID, request, tier)
}

func (s *Service) SendMessageWithTierContext(ctx context.Context, sessionID, userID string, request AgentMessageRequest, tier MikaTier) error {
	request.UserMessage = strings.TrimSpace(request.UserMessage)
	request.Mode = NormalizeMode(request.Mode)
	request.ActiveRoot = strings.TrimSpace(request.ActiveRoot)
	if request.UserMessage == "" {
		return ErrInvalidRequest("user_message is required")
	}
	if len(request.UserMessage) > MaxUserMessageBytes {
		return ErrInvalidRequest("user_message is too large")
	}
	if request.ActiveRoot != "" && !isSafeActiveRoot(request.ActiveRoot) {
		return ErrInvalidRequest("active_root must be an opaque scope ID or a relative display name")
	}
	for _, selected := range request.SelectedPaths {
		if _, ok := normalizeRelativePath(selected); !ok {
			return ErrInvalidRequest("selected_paths must contain only safe relative paths")
		}
	}
	return s.store.WithSessionContext(ctx, sessionID, userID, func(ctx context.Context, session *Session) error {
		if session.Canceled {
			return ErrInvalidRequest("session is canceled")
		}
		session.Mode = request.Mode
		session.MikaTier = NormalizeMikaTier(tier)
		session.ActiveRoot = request.ActiveRoot
		session.Capabilities = request.Capabilities
		session.ProviderCallsThisTurn = 0
		session.ToolResults = nil
		clear(session.PendingToolRequests)
		for _, selected := range request.SelectedPaths {
			if normalized, ok := normalizeRelativePath(selected); ok {
				session.KnownPaths[normalized] = struct{}{}
			}
		}
		session.Messages = append(session.Messages, Message{Role: "user", Content: request.UserMessage})
		return s.advanceLocked(ctx, session)
	})
}

func isSafeActiveRoot(value string) bool {
	trimmed := strings.TrimSpace(value)
	if strings.HasPrefix(trimmed, "scope_") && !strings.ContainsAny(trimmed, "/\\:") {
		return true
	}
	_, ok := normalizeRelativePath(trimmed)
	return ok
}

func (s *Service) SubmitToolResults(sessionID, userID string, results []ToolResult) error {
	return s.SubmitToolResultsWithTier(sessionID, userID, results, MikaLow)
}

func (s *Service) SubmitToolResultsWithTier(sessionID, userID string, results []ToolResult, tier MikaTier) error {
	return s.SubmitToolResultsWithTierContext(context.Background(), sessionID, userID, results, tier)
}

func (s *Service) SubmitToolResultsWithTierContext(ctx context.Context, sessionID, userID string, results []ToolResult, tier MikaTier) error {
	if len(results) == 0 {
		return ErrInvalidRequest("tool results are required")
	}
	if len(results) > MaxToolResultsPerRequest {
		return ErrInvalidRequest("too many tool results")
	}
	totalBytes := 0
	for _, result := range results {
		totalBytes += len(result.Result) + len(result.Error)
	}
	if totalBytes > MaxToolResultBytes {
		return ErrInvalidRequest("tool results are too large")
	}
	return s.store.WithSessionContext(ctx, sessionID, userID, func(ctx context.Context, session *Session) error {
		if session.Canceled {
			return ErrInvalidRequest("session is canceled")
		}
		if session.ProviderCallsThisTurn >= providerCallLimit(session) {
			return ErrInvalidRequest("Mika tool step limit reached; send a new message to continue")
		}
		seen := make(map[string]struct{}, len(results))
		for _, result := range results {
			name, pending := session.PendingToolRequests[result.RequestID]
			if !pending || name != result.Name {
				return ErrInvalidRequest("tool result does not match an outstanding request")
			}
			if _, duplicate := seen[result.RequestID]; duplicate {
				return ErrInvalidRequest("duplicate tool result")
			}
			seen[result.RequestID] = struct{}{}
		}
		for requestID := range seen {
			delete(session.PendingToolRequests, requestID)
		}
		session.MikaTier = NormalizeMikaTier(tier)
		if containsPreviewFileResult(results) {
			for index := range session.ToolResults {
				if session.ToolResults[index].Name == ToolPreviewFile {
					session.ToolResults[index] = sanitizeToolResult(session.ToolResults[index])
				}
			}
		}
		session.ToolResults = append(session.ToolResults, results...)
		collectKnownPaths(session, results)
		return s.advanceLocked(ctx, session)
	})
}

func (s *Service) Events(sessionID, userID string, after int64) ([]AgentEvent, error) {
	return s.store.Events(sessionID, userID, after)
}

// Transcript returns the conversation as plain messages, for a client rebuilding
// a session it does not hold locally. Replaying the event stream would be wrong
// for that: events carry tool requests, and a client that replayed them would
// run the tools a second time.
func (s *Service) Transcript(ctx context.Context, sessionID, userID string) ([]Message, error) {
	var messages []Message
	err := s.store.WithSessionContext(ctx, sessionID, userID, func(_ context.Context, session *Session) error {
		messages = append(messages, session.Messages...)
		return nil
	})
	return messages, err
}

// AppendExternalAssistantMessage delivers the terminal result of delegated
// work back into the originating Mika session without invoking the model.
// WithSessionContext persists both the message and its sequenced event.
func (s *Service) AppendExternalAssistantMessage(ctx context.Context, sessionID, userID, runID, text string) (*AgentEvent, error) {
	var appended AgentEvent
	err := s.store.WithSessionContext(ctx, sessionID, userID, func(_ context.Context, session *Session) error {
		message := strings.TrimSpace(text)
		if message == "" {
			return ErrInvalidRequest("assistant message is required")
		}
		session.Messages = append(session.Messages, Message{Role: "assistant", Content: message})
		session.appendEvent(AgentEvent{Type: EventAssistantMessage, RunID: runID, Text: message})
		appended = session.Events[len(session.Events)-1]
		return nil
	})
	return &appended, err
}

func (s *Service) Cancel(sessionID, userID string) error {
	return s.store.Cancel(sessionID, userID)
}

func (s *Service) Forget(sessionID, userID string) error {
	return s.store.Forget(sessionID, userID)
}

func (s *Service) advanceLocked(ctx context.Context, session *Session) error {
	if session.ProviderCallsThisTurn >= providerCallLimit(session) {
		return ErrInvalidRequest("Mika tool step limit reached; send a new message to continue")
	}
	session.ProviderCallsThisTurn++
	request := ModelRequest{
		SessionID:    session.ID,
		UserID:       session.UserID,
		MikaTier:     session.MikaTier,
		Mode:         session.Mode,
		ActiveRoot:   session.ActiveRoot,
		Messages:     append([]Message(nil), session.Messages...),
		ToolResults:  append([]ToolResult(nil), session.ToolResults...),
		Capabilities: session.Capabilities,
		KnownPaths:   knownPaths(session),
	}
	if requestSizeBytes(request) > MaxProviderRequestBytes {
		return ErrInvalidRequest("Mika request context is too large; start a new conversation")
	}
	selectedProvider := resolveMikaProvider(s.provider, session.MikaTier)
	provider, model := providerStatus(selectedProvider)
	idempotencyKey := fmt.Sprintf("%s:%d", session.ID, session.nextSequence+1)
	if session.BillingScope != "" {
		idempotencyKey = fmt.Sprintf("%s:%d", session.BillingScope, session.ProviderCallsThisTurn)
	}
	var reservation *UsageReservation
	var err error
	if s.meter != nil && provider != ProviderMock {
		billingUserID := session.BillingUserID
		if billingUserID == "" {
			billingUserID = session.UserID
		}
		reservation, err = s.meter.Reserve(billingUserID, idempotencyKey, "assistant_ai", provider, model, estimateRequestTokens(request), MaxModelOutputTokens)
		if err != nil {
			return err
		}
	}
	response, err := nextProvider(ctx, selectedProvider, request)
	if err != nil {
		if reservation != nil {
			_ = s.meter.Release(reservation)
		}
		if errors.Is(err, context.Canceled) {
			return err
		}
		log.Printf("Mika provider request failed for tier %s: %v", session.MikaTier, err)
		session.appendEvent(AgentEvent{Type: EventError, Message: "Mika could not complete this request."})
		return nil
	}
	response.Citations = groundedAgentCitations(request, response.Citations)
	settlement := UsageSettlement{}
	if reservation != nil {
		settlement, err = s.meter.Settle(reservation, idempotencyKey+":settle", "assistant_ai", provider, model, response.Usage)
		if err != nil {
			_ = s.meter.Release(reservation)
			return err
		}
	}
	if strings.TrimSpace(response.Text) != "" {
		session.Messages = append(session.Messages, Message{Role: "assistant", Content: response.Text})
		session.appendEvent(AgentEvent{Type: EventAssistantMessage, Text: response.Text, Citations: response.Citations, CreditsUsed: settlement.CreditsUsed, CreditsRemaining: settlement.CreditsRemaining})
	}
	if len(response.ToolRequests) > 0 {
		if session.ProviderCallsThisTurn >= providerCallLimit(session) {
			clear(session.PendingToolRequests)
			session.appendEvent(AgentEvent{Type: EventError, Message: "Mika reached the tool step limit. Send a new message to continue."})
			return nil
		}
		requests, rejected := authorizeToolRequests(session.Capabilities, response.ToolRequests)
		if rejected > 0 {
			session.appendEvent(AgentEvent{Type: EventError, Message: "Mika requested a tool outside the allowed capability envelope."})
		}
		requests = s.policy.Apply(session.Mode, requests)
		if len(requests) > MaxToolResultsPerRequest {
			requests = requests[:MaxToolResultsPerRequest]
		}
		clear(session.PendingToolRequests)
		for _, request := range requests {
			session.PendingToolRequests[request.ID] = request.Name
		}
		session.appendEvent(AgentEvent{Type: EventToolRequest, ToolRequests: requests})
	} else {
		clear(session.PendingToolRequests)
	}
	if response.FilePlan != nil {
		problems := ValidateFilePlan(*response.FilePlan, PlanValidationContext{KnownPaths: knownPaths(session)})
		if len(problems) > 0 {
			plan := *response.FilePlan
			plan.Warnings = append(plan.Warnings, problems...)
			session.appendEvent(AgentEvent{Type: EventFilePlan, FilePlan: &plan})
			return nil
		}
		session.appendEvent(AgentEvent{Type: EventFilePlan, FilePlan: response.FilePlan})
	}
	return nil
}

func authorizeToolRequests(manifest ToolManifest, requests []ToolRequest) ([]ToolRequest, int) {
	allowed := make(map[string]ToolDefinition, len(manifest.Tools))
	for _, definition := range manifest.Tools {
		definition.Name = strings.TrimSpace(definition.Name)
		if definition.Name != "" {
			allowed[definition.Name] = definition
		}
	}
	authorized := make([]ToolRequest, 0, len(requests))
	rejected := 0
	for _, request := range requests {
		definition, ok := allowed[request.Name]
		if len(request.Arguments) == 0 {
			request.Arguments = json.RawMessage(`{}`)
		}
		if !ok || !validToolArguments(request.Arguments) {
			rejected++
			continue
		}
		// The published/provider manifest is authoritative. A model cannot
		// downgrade a write or destructive request by labeling it as a read.
		request.Risk = normalizeRisk(definition.Risk)
		authorized = append(authorized, request)
	}
	return authorized, rejected
}

func validToolArguments(raw json.RawMessage) bool {
	if len(raw) == 0 || len(raw) > 256<<10 {
		return false
	}
	var object map[string]any
	return json.Unmarshal(raw, &object) == nil && object != nil
}

func containsPreviewFileResult(results []ToolResult) bool {
	for _, result := range results {
		if result.Name == ToolPreviewFile && result.OK {
			return true
		}
	}
	return false
}

func providerCallLimit(session *Session) int {
	if strings.HasPrefix(session.BillingScope, "agent-job:") {
		for _, tool := range session.Capabilities.Tools {
			if tool.Name == ToolPreviewFile {
				return MaxDocumentCallsPerTurn
			}
		}
	}
	return MaxProviderCallsPerTurn
}

func estimateRequestTokens(request ModelRequest) int64 {
	characters := requestSizeBytes(request)
	return int64(characters/4 + 256)
}

func requestSizeBytes(request ModelRequest) int {
	characters := 0
	for _, message := range request.Messages {
		characters += len(message.Content)
	}
	for _, result := range request.ToolResults {
		characters += len(result.Result) + len(result.Error)
	}
	characters += len(request.ActiveRoot)
	for _, path := range request.KnownPaths {
		characters += len(path)
	}
	for _, tool := range request.Capabilities.Tools {
		characters += len(tool.Name) + len(tool.Risk)
	}
	return characters
}

func knownPaths(session *Session) []string {
	paths := make([]string, 0, len(session.KnownPaths))
	for path := range session.KnownPaths {
		paths = append(paths, path)
	}
	return paths
}

func collectKnownPaths(session *Session, results []ToolResult) {
	for _, result := range results {
		if !result.OK || len(result.Result) == 0 {
			continue
		}
		var payload any
		if err := json.Unmarshal(result.Result, &payload); err != nil {
			continue
		}
		collectKnownPathsFromValue(session, payload)
	}
}

func collectKnownPathsFromValue(session *Session, value any) {
	switch typed := value.(type) {
	case map[string]any:
		for _, key := range []string{"relativePath", "relative_path", "path", "name"} {
			if raw, ok := typed[key].(string); ok {
				collectKnownPathString(session, raw)
			}
		}
		for _, child := range typed {
			collectKnownPathsFromValue(session, child)
		}
	case []any:
		for _, child := range typed {
			collectKnownPathsFromValue(session, child)
		}
	}
}

func collectKnownPathString(session *Session, value string) {
	if normalized, ok := normalizeRelativePath(value); ok {
		session.KnownPaths[normalized] = struct{}{}
		return
	}
	root := strings.TrimRight(strings.TrimSpace(session.ActiveRoot), "/")
	candidate := strings.TrimSpace(strings.ReplaceAll(value, "\\", "/"))
	if root != "" && strings.HasPrefix(candidate, root+"/") {
		if normalized, ok := normalizeRelativePath(strings.TrimPrefix(candidate, root+"/")); ok {
			session.KnownPaths[normalized] = struct{}{}
			return
		}
	}
	if base := filepath.Base(candidate); base != "." && base != "/" {
		if normalized, ok := normalizeRelativePath(base); ok {
			session.KnownPaths[normalized] = struct{}{}
		}
	}
}

type ErrInvalidRequest string

func (e ErrInvalidRequest) Error() string {
	return string(e)
}
