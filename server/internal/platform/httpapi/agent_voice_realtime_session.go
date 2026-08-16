package api

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/gorilla/websocket"
	agent "github.com/kannachi323/misty/server/internal/agents"
)

// voiceRealtimeSession reads one completed answer aloud. Its run loop is the
// only writer to the client, the provider and the usage ledger.
type voiceRealtimeSession struct {
	ctx       context.Context
	client    *websocket.Conn
	provider  voiceProvider
	hooks     voiceSessionHooks
	startedAt time.Time
	rtc       bool

	// Closed by the reader goroutines; set to nil once handled.
	clientGone, providerGone chan struct{}
	upstream                 chan agent.VoiceRealtimeEvent
	deadline                 *time.Timer
	lastClient               time.Time

	usage agent.RealtimeVoiceUsage
	state voiceSessionState

	playbackStarted, playbackStopped             bool
	transcriptionKnown, responseKnown, uncertain bool
	closedClient, replyStarted, billingFinished  bool
	firstAudio                                   bool

	speechChunks     []string
	pendingSpeech    string
	pendingLimit     int
	contextBytes     int
	chunkOutputBytes int
}

func runVoiceSession(ctx context.Context, client *websocket.Conn, provider voiceProvider, hooks voiceSessionHooks) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	client.SetReadLimit(100 << 10)
	incoming := make(chan voiceClientEvent, 8)
	s := &voiceRealtimeSession{
		ctx: ctx, client: client, provider: provider, hooks: hooks, startedAt: time.Now(),
		clientGone: make(chan struct{}), providerGone: make(chan struct{}), upstream: make(chan agent.VoiceRealtimeEvent, 16),
		usage: agent.RealtimeVoiceUsage{}, firstAudio: true,
	}
	clientGone, providerGone := s.clientGone, s.providerGone
	go func() {
		defer close(clientGone)
		for {
			var event voiceClientEvent
			if client.ReadJSON(&event) != nil {
				return
			}
			select {
			case incoming <- event:
			case <-ctx.Done():
				return
			}
		}
	}()
	go func() {
		defer close(providerGone)
		for {
			event, err := provider.Read()
			if err != nil {
				return
			}
			select {
			case s.upstream <- event:
			case <-ctx.Done():
				return
			}
		}
	}()
	rtcProvider, rtc := provider.(interface{ WebRTC() bool })
	s.rtc = rtc && rtcProvider.WebRTC()
	defer func() {
		if err := s.finalize(); err != nil {
			log.Printf("voice_usage_pending operation_id=%q", hooks.OperationID)
		}
	}()
	if provider.Configure() != nil {
		s.fail("Voice session setup failed.")
		return
	}
	s.deadline = time.NewTimer(20 * time.Second)
	defer s.deadline.Stop()
	// Backend work has no total voice timeout. Client keepalives keep it open;
	// recording/setup/transcription/generation have separate progress deadlines.
	s.lastClient = time.Now()
	check := time.NewTicker(20 * time.Second)
	defer check.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-s.clientGone:
			if s.stopClient() {
				return
			}
		case <-s.providerGone:
			// Drain already-received final usage before treating a closed socket as
			// unknown. The provider channel closes only after its last queued event.
			s.providerGone = nil
			if len(s.upstream) == 0 {
				s.fail("The voice connection stopped. Your completed answer is saved.")
				return
			}
		case <-s.deadline.C:
			s.fail("The voice stage stopped making progress. Please try again.")
			return
		case <-check.C:
			if !s.healthy() {
				return
			}
		case event := <-incoming:
			if s.handleClient(event) {
				return
			}
		case event := <-s.upstream:
			stop, settled := s.handleUpstream(event)
			if stop {
				return
			}
			if !settled && s.providerGone == nil && len(s.upstream) == 0 {
				s.fail("The voice connection closed.")
				return
			}
		}
	}
}

func (s *voiceRealtimeSession) stage(name string) {
	log.Printf("voice_stage operation_id=%q stage=%s elapsed_ms=%d", s.hooks.OperationID, name, time.Since(s.startedAt).Milliseconds())
}

func (s *voiceRealtimeSession) write(event any) error {
	if s.closedClient {
		return nil
	}
	_ = s.client.SetWriteDeadline(time.Now().Add(10 * time.Second))
	return s.client.WriteJSON(event)
}

func (s *voiceRealtimeSession) fail(message string) {
	log.Printf("voice_stage_failed operation_id=%q detail=%q", s.hooks.OperationID, message)
	_ = s.write(map[string]string{"type": "error", "message": message})
}

func (s *voiceRealtimeSession) finalize() error {
	if s.billingFinished {
		return nil
	}
	s.billingFinished = true
	settleCtx, finish := context.WithTimeout(context.Background(), 20*time.Second)
	defer finish()
	known := !s.uncertain && (!s.state.Committed || s.transcriptionKnown) && (!s.state.Responding || s.responseKnown)
	if !known {
		if err := s.hooks.Checkpoint(settleCtx, "reconcile", s.usage); err != nil {
			return err
		}
		return errors.New("voice_usage_pending")
	}
	action := "release"
	for _, value := range s.usage {
		if value > 0 {
			action = "settle"
			break
		}
	}
	if err := s.hooks.Checkpoint(settleCtx, "settlement_pending", s.usage); err != nil {
		return err
	}
	if err := s.hooks.Complete(settleCtx, action, s.usage); err != nil {
		return err
	}
	return s.hooks.Checkpoint(settleCtx, "closed", s.usage)
}

func (s *voiceRealtimeSession) reset(duration time.Duration) {
	if !s.deadline.Stop() {
		select {
		case <-s.deadline.C:
		default:
		}
	}
	s.deadline.Reset(duration)
}

func (s *voiceRealtimeSession) advance() error {
	if s.hooks.Advance == nil {
		return nil
	}
	finish, stop := context.WithTimeout(context.Background(), 20*time.Second)
	defer stop()
	return s.hooks.Advance(finish, s.usage)
}

// stopClient handles a closed or canceled client. It keeps waiting only for
// usage already in flight and reports whether the session can end now.
func (s *voiceRealtimeSession) stopClient() bool {
	s.clientGone = nil
	s.closedClient = true
	switch {
	case s.state.Responding && !s.responseKnown:
		_ = s.provider.Send(map[string]string{"type": "response-cancel"})
		s.reset(5 * time.Second)
	case s.state.Committed && !s.transcriptionKnown:
		s.reset(5 * time.Second)
	default:
		return true
	}
	return false
}

// healthy rechecks the client keepalive, access and accounting.
func (s *voiceRealtimeSession) healthy() bool {
	if time.Since(s.lastClient) > 70*time.Second {
		s.fail("The voice client disconnected.")
		return false
	}
	if err := s.hooks.Access(s.ctx); err != nil {
		s.fail("Voice access is no longer available.")
		return false
	}
	if err := s.hooks.Checkpoint(s.ctx, "active", s.usage); err != nil {
		s.fail("Voice accounting is unavailable.")
		return false
	}
	return true
}

func (s *voiceRealtimeSession) startSpeech() error {
	text := s.speechChunks[0]
	estimate, limit := voiceSpeechFacts(text, s.contextBytes, int(s.usage["output_text_tokens"]), s.state.AudioBytes, int(s.usage["output_audio_tokens"]))
	if s.hooks.Speech != nil {
		if err := s.hooks.Speech(s.ctx, estimate); err != nil {
			return err
		}
	}
	s.speechChunks = s.speechChunks[1:]
	s.pendingSpeech = text
	s.pendingLimit = limit
	s.state.Responding = false
	s.state.ResponseID = ""
	s.responseKnown = false
	s.playbackStarted, s.playbackStopped = false, false
	s.chunkOutputBytes = 0
	s.reset(20 * time.Second)
	return s.provider.SetOutputLimit(limit)
}

// finishSpeech starts the next reply segment, or settles and ends the session.
func (s *voiceRealtimeSession) finishSpeech() bool {
	if s.closedClient {
		return true
	}
	if len(s.speechChunks) > 0 {
		if err := s.startSpeech(); err != nil {
			s.fail("Voice could not reserve the next part of the reply. The full answer is saved.")
			return true
		}
		return false
	}
	if err := s.finalize(); err != nil {
		s.fail("Voice accounting needs reconciliation.")
		return true
	}
	_ = s.write(map[string]string{"type": "done"})
	return true
}
