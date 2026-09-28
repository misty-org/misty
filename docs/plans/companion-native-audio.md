# Companion native audio integration

Implemented 2026-09-27 after the user authorized the sibling `misty-billing`
change. The companion now uses `openai/gpt-realtime-2.1` through its existing
AI Gateway. Ctrl+Option remains push-to-talk. This replaces the companion's
completed-WAV upload and separate mini-TTS chain; other composer transcription
clients retain their existing routes.

## Owned lifecycle

1. Native `audio.rs` starts the microphone on shortcut down. Its bounded sample
   buffer is drained by the audio worker, outside the capture callback, as
   sequenced mono signed PCM at 24 kHz. Release emits the last chunk and commits
   once. Generation changes, device errors and the one-minute cap stop capture.
2. `companionVoice.ts` obtains an authenticated ticket for the registered device.
   A ticket expires after 60 seconds, is single-use and is domain-separated from
   synchronization tickets. Only the ticket travels in the desktop WebSocket's
   subprotocol; gateway credentials and gateway tokens remain on the server.
3. The server reserves a bounded usage allowance and journals the session before
   opening the provider. Explicit disabled VAD must be confirmed in the provider
   session before `ready`. Audio sequence, duration and size are checked. Input
   ends only with manual commit. A final transcript includes measured usage.
4. The controller takes fresh desktop captures after transcription and submits
   through the existing shared invocation path. Explanation/action selection,
   account ownership, device attachments, leases and approvals remain there.
   The voice model has no tools. No model response is requested while this work
   runs; a prompt alone cannot guarantee silence before a verified result.
5. To speak, the client sends only the completed invocation ID. The server
   checks ownership and terminal state, derives and bounds its saved reply, then
   creates the audio response in the same session. Typed turns open a session at
   this stage without microphone input. PCM is streamed to bounded WebAudio
   playback; text and POINT remain in the established conversation/overlay UI.
6. Setup, recording, transcription, generation and playback have individual
   deadlines. Backend progress has no arbitrary total voice deadline. Explicit
   stop closes input/playback and drains final provider usage briefly. No voice
   reconnect replays a commit, and speech retry never repeats backend actions.

## Accounting

The companion operation is `agent.voice.realtime`. All rates and the existing
hosted buffer live in `../misty-billing/internal/policy/realtime.go`. The exact
supported model has independent input/output text/audio, cached-input subsets,
plus separately billed input-transcription tokens. Unknown models/units and
invalid or overflowing counters fail closed. The backend invocation is metered
separately as before. The server supplies raw measured counters, never prices.

The server journal contains only reservation identity, status, counts and time.
Known final usage is checkpointed before durable outbox settlement. Cancelled
responses settle consumed work; an unused session releases its hold. A provider
loss without complete counters retains its reservation in `reconcile`, rather
than guessing a charge or treating missing usage as zero. Stale sessions after a
server crash are marked for reconciliation; known pending completions retry with
the same idempotency key. Unknown usage still requires operator reconciliation
against provider records. This limitation is explicit, not automatic recovery.

## Validation and deployment

- Live synthetic Go-provider test: final input transcript, confirmed fixture
  reply, manual control, no early speech, 60,000 output PCM bytes and complete
  modality/transcription counters. [Metadata](../fixtures/companion-realtime-adapter-evidence.json).
- Regression checks: 13 voice transport/playback tests; 17 controller tests;
  native resampling at 8–192 kHz and chunk-boundary parity; Go race tests for
  protocol/cancellation/partial usage; full billing race suite.
- Isolated real databases: billing hold/settle/replay/account isolation, journal
  crash recovery, and authenticated ticket/device/revocation/domain/replay tests.
  The authenticated fixture also rejects foreign/unfinished replies and completes
  an owned saved reply through WebSocket audio and final accounting. No live
  account balances or writer settings changed.
- Rebuilt local billing, API and runtime containers are healthy. The native dev1
  process rebuilt through its existing watcher. Current image IDs/times are in
  the ledger. The local API still uses billing adapter `none`; the billing
  service's existing writer configuration was preserved. Deployed pricing is
  therefore not evidence of live commercial charging.
- Desktop acceptance remains blocked by macOS lock. Real microphone/speaker,
  exact fixture pointing, Count 0→1 authorized action and native overlay recovery
  still require an unlocked desktop. Windows hardware is unavailable here.

## Rebuild commands

From `../misty-billing`:

```sh
docker compose --env-file .env/dev/database.env -f compose.dev.yml up -d --build billing
```

From Misty:

```sh
misty server up --detach
```

The existing `misty` dev1 watcher rebuilds the native app and serves frontend
changes. These commands were executed for this integration; production deployment
and commercial writer activation were not performed.
