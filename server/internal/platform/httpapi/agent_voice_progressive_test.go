package api

import (
	"context"
	"encoding/base64"
	"errors"
	"strings"
	"testing"
	"time"

	agent "github.com/kannachi323/misty/server/internal/agents"
)

func voiceSent(t *testing.T, f *voiceFixture, want string) map[string]any {
	t.Helper()
	select {
	case e := <-f.provider.sent:
		if e["type"] != want {
			t.Fatalf("wanted %s, got %v", want, e)
		}
		return e
	case <-time.After(3 * time.Second):
		t.Fatalf("missing provider event %s", want)
	}
	return nil
}
func voiceFinished(t *testing.T, f *voiceFixture) {
	t.Helper()
	select {
	case <-f.finished:
	case <-time.After(3 * time.Second):
		t.Fatal("session did not finish")
	}
}
func TestVoiceRecordingDenialDoesNotForwardAudio(t *testing.T) {
	f := newVoiceFixtureHooks(t, func(h *voiceSessionHooks, _ *fixtureVoiceProvider) {
		h.Input = func(context.Context, int) error { return errors.New("denied") }
	})
	f.send(t, voiceClientEvent{Type: "audio.append", Audio: base64.StdEncoding.EncodeToString(make([]byte, 7200))})
	if e := f.read(t); e["type"] != "error" {
		t.Fatal(e)
	}
	voiceFinished(t, f)
	if len(f.provider.sent) != 0 {
		t.Fatal("unfunded audio reached provider")
	}
}
func TestVoiceTranscriptionSettlesBeforeTranscript(t *testing.T) {
	advanced := make(chan agent.RealtimeVoiceUsage, 1)
	f := newVoiceFixtureHooks(t, func(h *voiceSessionHooks, _ *fixtureVoiceProvider) {
		h.Advance = func(_ context.Context, u agent.RealtimeVoiceUsage) error {
			copy := agent.RealtimeVoiceUsage{}
			copy.Add(u)
			advanced <- copy
			return nil
		}
	})
	f.committed(t)
	f.transcript()
	if e := f.read(t); e["type"] != "transcript" {
		t.Fatal(e)
	}
	select {
	case usage := <-advanced:
		if usage["transcription_input_tokens"] != 15 {
			t.Fatal(usage)
		}
	default:
		t.Fatal("transcript preceded settlement")
	}
	f.client.Close()
	voiceFinished(t, f)
}
func TestVoiceRequiresConfirmedOutputCap(t *testing.T) {
	f := newVoiceFixtureHooks(t, func(_ *voiceSessionHooks, p *fixtureVoiceProvider) { p.limitOverride = 4096 })
	f.send(t, voiceClientEvent{Type: "reply", InvocationID: "owned-completed"})
	if e := f.read(t); e["type"] != "error" {
		t.Fatal(e)
	}
	voiceFinished(t, f)
	if len(f.provider.sent) != 0 {
		t.Fatal("generation started without bounded output")
	}
	if result := <-f.settled; result.Action != "release" {
		t.Fatal(result)
	}
}
func TestVoiceSpeechAdmitsOnlyNextChunkAfterSettlement(t *testing.T) {
	for _, denyNext := range []bool{false, true} {
		t.Run(map[bool]string{false: "continue", true: "denied"}[denyNext], func(t *testing.T) {
			calls := make(chan string, 8)
			count := 0
			f := newVoiceFixtureHooks(t, func(h *voiceSessionHooks, _ *fixtureVoiceProvider) {
				h.Reply = func(context.Context, string) (string, error) { return strings.Repeat("a", 400), nil }
				h.Speech = func(_ context.Context, u agent.RealtimeVoiceUsage) error {
					count++
					calls <- "reserve"
					if denyNext && count == 2 {
						return errors.New("denied")
					}
					return nil
				}
				h.Advance = func(context.Context, agent.RealtimeVoiceUsage) error { calls <- "settle"; return nil }
			})
			f.respond(t)
			if call := <-calls; call != "reserve" {
				t.Fatal(call)
			}
			if len(calls) != 0 {
				t.Fatal("reserved future speech")
			}
			f.provider.events <- agent.VoiceRealtimeEvent{Type: "audio-delta", ResponseID: "reply1", Delta: "AAAAAA=="}
			f.responseDone("completed")
			if e := f.read(t); e["type"] != "audio" {
				t.Fatal(e)
			}
			for _, want := range []string{"settle", "reserve"} {
				select {
				case got := <-calls:
					if got != want {
						t.Fatal(got, want)
					}
				case <-time.After(3 * time.Second):
					t.Fatal("missing", want)
				}
			}
			if denyNext {
				if e := f.read(t); e["type"] != "error" {
					t.Fatal(e)
				}
				voiceFinished(t, f)
				if len(f.provider.sent) != 0 {
					t.Fatal("unfunded next chunk reached provider")
				}
			} else {
				item := voiceSent(t, f, "conversation-item-create")
				if text := item["item"].(map[string]any)["text"].(string); !strings.HasSuffix(text, strings.Repeat("a", 80)) {
					t.Fatal(text)
				}
				voiceSent(t, f, "response-create")
				f.provider.events <- agent.VoiceRealtimeEvent{Type: "response-created", ResponseID: "reply1"}
				f.provider.events <- agent.VoiceRealtimeEvent{Type: "audio-delta", ResponseID: "reply1", Delta: "AAAAAA=="}
				f.responseDone("completed")
				if e := f.read(t); e["type"] != "audio" {
					t.Fatal(e)
				}
				if e := f.read(t); e["type"] != "done" {
					t.Fatal(e)
				}
				voiceFinished(t, f)
			}
		})
	}
}
func TestVoiceCancellationNeverAdmitsRemainingSpeech(t *testing.T) {
	admissions := make(chan struct{}, 8)
	f := newVoiceFixtureHooks(t, func(h *voiceSessionHooks, _ *fixtureVoiceProvider) {
		h.Reply = func(context.Context, string) (string, error) { return strings.Repeat("word ", 100), nil }
		h.Speech = func(context.Context, agent.RealtimeVoiceUsage) error { admissions <- struct{}{}; return nil }
	})
	f.respond(t)
	f.provider.events <- agent.VoiceRealtimeEvent{Type: "audio-delta", ResponseID: "reply1", Delta: "AAAAAA=="}
	if e := f.read(t); e["type"] != "audio" {
		t.Fatal(e)
	}
	f.send(t, voiceClientEvent{Type: "cancel"})
	voiceSent(t, f, "response-cancel")
	// Completion can win the race with cancellation at the provider.
	f.responseDone("completed")
	voiceFinished(t, f)
	if len(admissions) != 1 {
		t.Fatal("cancel reserved another chunk")
	}
}
func TestWebRTCVoiceWaitsForPlaybackBeforeNextReservation(t *testing.T) {
	admissions := make(chan struct{}, 8)
	settlements := make(chan struct{}, 8)
	f := newVoiceFixtureHooks(t, func(h *voiceSessionHooks, _ *fixtureVoiceProvider) {
		h.Reply = func(context.Context, string) (string, error) { return strings.Repeat("word ", 100), nil }
		h.Speech = func(context.Context, agent.RealtimeVoiceUsage) error { admissions <- struct{}{}; return nil }
		h.Advance = func(context.Context, agent.RealtimeVoiceUsage) error { settlements <- struct{}{}; return nil }
	}, true)
	f.respond(t)
	f.provider.events <- agent.VoiceRealtimeEvent{Type: "playback-started", ResponseID: "reply1"}
	if e := f.read(t); e["type"] != "playing" {
		t.Fatal(e)
	}
	f.responseDone("completed")
	select {
	case <-settlements:
	case <-time.After(3 * time.Second):
		t.Fatal("usage not settled")
	}
	// A ping round trip ensures response-done processing finished.
	f.send(t, voiceClientEvent{Type: "ping"})
	if e := f.read(t); e["type"] != "pong" {
		t.Fatal(e)
	}
	if len(admissions) != 1 {
		t.Fatal("admitted before playback finished")
	}
	f.provider.events <- agent.VoiceRealtimeEvent{Type: "playback-stopped", ResponseID: "reply1"}
	voiceSent(t, f, "conversation-item-create")
	voiceSent(t, f, "response-create")
	if len(admissions) != 2 {
		t.Fatal("next chunk not admitted")
	}
	f.client.Close()
	voiceSent(t, f, "response-cancel")
	f.provider.events <- agent.VoiceRealtimeEvent{Type: "response-created", ResponseID: "reply1"}
	f.responseDone("cancelled")
	voiceFinished(t, f)
}
