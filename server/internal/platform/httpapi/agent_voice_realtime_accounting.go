package api

import (
	"context"

	"github.com/gorilla/websocket"
	agent "github.com/kannachi323/misty/server/internal/agents"
)

func (s *AgentsService) runVoiceRealtime(ctx context.Context, client *websocket.Conn, provider voiceProvider, operation, user, device string) {
	billing := s.database.BillingService()
	budget := &voiceReservations{operation: operation, user: user, model: voiceProviderModel(provider), reserve: billing.Reserve, estimate: voiceBillingEstimate(billing), disabled: !billing.Adapter.Enabled(), record: s.database.RecordVoiceUsage, complete: billing.Complete}
	runVoiceSession(ctx, client, provider, voiceSessionHooks{
		OperationID: operation,
		Access:      func(ctx context.Context) error { return s.voiceAccess(ctx, user, device) },
		Reply: func(ctx context.Context, id string) (string, error) {
			if err := s.voiceAccess(ctx, user, device); err != nil {
				return "", err
			}
			return s.ownedVoiceReply(ctx, user, id)
		},
		Input: budget.input,
		Speech: func(ctx context.Context, units agent.RealtimeVoiceUsage) error {
			return budget.admit(ctx, "speech", units)
		},
		Advance:    budget.finish,
		Checkpoint: budget.checkpoint,
		Complete: func(ctx context.Context, _ string, usage agent.RealtimeVoiceUsage) error {
			return budget.finish(ctx, usage)
		},
	})
}
