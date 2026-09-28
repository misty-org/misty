# Clicky → Misty architecture and acceptance matrix

Source baseline: `vendor/clicky/leanring-buddy` and `vendor/clicky/worker/src/index.ts`.
Audit date: 2026-09-27. See [issue ledger](clicky-integration-ledger.md) for
reproductions, current evidence and unresolved checks. Source parity is not
runtime acceptance. The reference executable is not running on this host.

## Desktop takeover update — 2026-09-28

The user explicitly superseded the Team/Auto interaction split and the earlier
embedded-browser-only action design. There is one task policy: answer naturally,
and acquire desktop control when the task needs screen interaction. Ask is off
by default; enabling it requires human confirmation before each new takeover.
Historical Team/Auto wire values remain compatible and have identical policy.
The older acceptance tables below are historical checkpoints; CK-022 in the
ledger is the current desktop acceptance record.

- The initial typed/voice context still uses labeled ScreenCaptureKit stills
  after final transcription. A conversational answer does not freeze input.
- Native macOS main-window tasks attach desktop visual/interact tools. Their
  inert webview carries the existing authenticated device/task execution grants;
  it is not a hidden browser substitute for visible actions.
- The first desktop visual call checks native ownership, Ask, Screen Recording,
  and Accessibility, then opens a real SCStream and input-control session.
  `MistyDesktopCapture.m` retains only the latest JPEG in memory (5 fps, max 2000
  pixels on the longest edge). Complete and explicit idle frames establish
  freshness. Stream failure, startup failure and display loss fail visibly.
- `MistyDesktopControl.m` posts tagged CGSession mouse/keyboard events into the
  foreground application. Every action consumes one fresh snapshot, rechecks
  task, foreground PID and display geometry, and requires subsequent observation
  before a success claim. AddressBar/NewTab/Find support external browser work.
- A persistent native bottom strip and Escape return input to the user. Other
  human clicks, typing, dragging, scrolling and tab/window shortcuts are filtered
  during control; pointer movement can reach Stop without retargeting the display.
  Control+Option also interrupts for a new voice turn. There is no claim that
  macOS reserved shortcuts, other accessibility clients or app animations freeze.
- Stop, completion, cancellation, account teardown, capture failure, input-tap
  failure and missed 30-second lease renewal release the tap, HUD and stream.
  No grant survives into a successor task. Ask is a native confirmation before
  any actionable snapshot exists, not a suggestion in a model prompt.
- Desktop takeover currently requires macOS 14.4+ (the existing native workspace
  gate). Windows/older macOS retain their supported context/browser paths; global
  desktop takeover is not claimed on those platforms or across multiple monitors.

This is an intentional expansion beyond vendored Clicky, whose screen path uses
SCScreenshotManager still images and has no native action executor or SCStream.

## Reference timeline, reconstructed through callers

1. `leanring_buddyApp.swift` creates CompanionManager through its app delegate.
   `CompanionManager.start` refreshes accessibility, screen-recording, microphone
   and saved screen-content permission state, starts a 1.5-second poll, binds
   voice/shortcut state and eagerly initializes ClaudeAPI for TLS warmup.
   `requestScreenContentPermission` explicitly performs a **320×240 test still**.
   Permission being granted does not mean there is an active recording session.
2. `GlobalPushToTalkShortcutMonitor.swift` uses a listen-only CGEvent tap. Down
   cancels response/TTS/hide/pointing and summons the overlay. It starts an
   owned pending dictation Task. No display capture is called on shortcut-down.
3. `BuddyDictationManager.startPushToTalk` checks permissions and start identity.
   `startRecognitionSession` obtains the transcription session, installs an
   `AVAudioEngine.inputNode` tap and starts the engine. PCM buffers go to the
   provider and levels to the waveform. AssemblyAI uses a shared URLSession and
   short-lived token/WebSocket; OpenAI buffers audio for upload; Apple Speech
   uses its speech-recognition request. None obtains microphone input from
   ScreenCaptureKit. `BuddyAudioConversionSupport.swift` owns conversion/WAV.
4. Up cancels a still-pending start, stops audio, and finalizes transcription
   through the provider. The final-text callback calls
   `sendTranscriptToClaudeWithScreenshot`. Only now does
   `CompanionScreenCaptureUtility.captureAllScreensAsJPEG` enumerate and capture
   displays via `SCScreenshotManager.captureImage`. There is no SCStream or
   stream delegate/start/stop owner anywhere in this vendored Swift checkout.
   SCStreamConfiguration supplies still-image dimensions, not a video session.
5. Displays are sorted cursor-first, mapped to NSScreen frames, filtered to
   exclude the application's windows, scaled to a 1280px maximum dimension,
   JPEG encoded at 0.8, then labeled with screenshot pixel dimensions. ClaudeAPI
   sends labeled images and up to ten exchanges through the worker's `/chat`.
6. SSE text is accumulated. Manager parses POINT, scales **image pixels** into
   display points, flips AppKit Y, selects the named display, animates the cursor,
   stores text history and requests ElevenLabs `/tts`. Playback and pointing
   finish before the transient 1-second hide. A new turn cancels the old one.

Source comments are not treated as proof: Clicky's permission probe tests only
nonzero dimensions (its comment overstates empty-image detection); its UI state
can return idle before playback ends; its worker logs raw provider errors and
its generic credits fallback does not attribute every error correctly. These
are not copied into Misty.

## Architecture / parity / acceptance

| Stage | Clicky source | Misty implementation | Parity or justified difference | Acceptance still required |
|---|---|---|---|---|
| App/permission startup | app delegate; Manager.start/requestScreenContentPermission; WindowPositionManager | Controller configure; Rust platform permission checks; Settings | No persistent stream. Misty account-bound host, permission errors visible; native permission probe UI differs | fresh grant, denial, revocation and restart |
| Shortcut and microphone | GlobalPushToTalkShortcutMonitor; BuddyDictationManager | Rust platform tap / Windows hook; cpal audio.rs | Listen-only; independently owned audio. cpal serves both supported platforms | live down/up, quick release, denial, one-minute cap |
| Transcription | provider protocol/factory; AssemblyAI/OpenAI/Apple implementations | native sequenced 24 kHz PCM → authenticated server relay → gateway Realtime final transcript | User-requested native audio session; credentials/metering remain server-owned | real microphone, interruption and permission denial |
| Frame timing | finalized transcript → capture → model | shared controller capture after final transcript, or immediately on typed submit | Reference ordering restored; typed follow-up also gets fresh capture | change page during transcription and verify submitted bytes |
| macOS frames | CompanionScreenCaptureUtility, SCScreenshotManager | MistyCompanionCapture.m → platform.capture_display → host capture_displays | Direct port: still API, filtering, resize, JPEG; no video or audio stream | macOS indicator, pixels, overlay exclusion, permissions |
| Windows frames | unavailable in reference | xcap still acquisition + JPEG in platform.rs | Required platform adaptation; coordinates remain Windows physical pixels | Windows hardware unavailable here |
| Context ownership | Manager currentResponseTask/captures/history | Controller generation + native turn + submissionEpoch + task lease | Misty has authenticated persistent tasks and a shared Agents conversation | rapid turns, logout, worker isolation |
| Model submission | ClaudeAPI label/image parts, ten exchanges | Go companion prompt/context; runtime ModelMessage tagged FileParts | Keep supported model/provider selection; preserve ownership and account boundary | image hashes/decoded dimensions at all boundaries; vision support |
| Explanation versus action | text/point response, no agent tools | Explicit explanation admission (no task/tools), plus permission-aware executor for actions | Action execution is Misty product functionality absent from Clicky | paired explanation and safe action; no unsolicited navigation |
| Streaming/recovery | ClaudeAPI SSE, task cancellation | invocation SSE with event IDs, replay dedupe, 45s transport-idle recovery | Durable task may outlive network; reconnect same invocation, never repeat actions | disconnect, slow live task, approvals, missing terminal event |
| Speech | ElevenLabsTTSClient/AVAudioPlayer | owned completed invocation → same gateway Realtime session → streamed PCM/WebAudio | No response requested before verified completion; preserve text and independent pointing on speech failure | real speaker playback, interruption and retry; desktop locked |
| Pointing | Manager parsing; OverlayWindow curved motion; ResponseOverlay | companionReply/resolvePoint; CursorCompanionRoot/motion | CG top-left on macOS avoids unnecessary AppKit flip in renderer; scale from image dimensions | Retina, negative origins, removal, fresh tool captures |
| Stacking | nonactivating transparent NSPanel | native overlays + independently reasoned browser suspension | Misty includes native browser workspaces; Clicky has none | simultaneous Search/Misty, active task, reload, worker windows |

## Context by entry point

| Entry | Capture source and time | Model route and limitations |
|---|---|---|
| Ctrl+Option / Windows shortcut | all desktop displays after finalized transcription, cursor-first | displayCaptures → display_captures → runtime image parts; same turn owns speech/pointing |
| Typed Agents companion / typed follow-up | same shared controller captures on submit | same display/model/response lifecycle; no stale retained frame |
| Ordinary GlobalMisty composer | screen-referencing requests without explicit selection use the shared desktop companion capture; otherwise external foreground window if screenStatus.external, explicit handoff/capture, or host context | `capture` is distinct from companion display captures; browser refs/DOM do not imply an image |
| Composer microphone button | transcription populates typed draft; capture occurs on submit | follows that composer's route; recording alone does not capture |
| Explicit selection/capture/handoff | handoff capture/selection chosen by caller | preserve explicit scope, not interchangeable with whole desktop |
| Browser tab tools | inspect returns DOM; visual returns browser image or companion task's fresh displays | browser.visual calls task_visual only for the bound native turn/task; zoom/scroll can invalidate older coordinates |
| External app | ordinary composer uses MistyContext.m foreground-window SCK; companion uses desktop-display SCK | window crop cannot be mapped with display POINT coordinates |
| Active task follow-up | task is paused before routing; companion normal-tab continuations and screen-referencing steering call shared capture again | does not blindly replay prior actions; missing main-window capture explains the limitation and leaves the task paused |
| Worker window | AgentWorkerRoot accepts authorized task.capture/handoff; local execution tools | does not own main companion configuration. Screen-referencing composer requests require an image or direct the user to the main desktop window |

## Substantive departures and constraints

- **OS availability:** Misty supports macOS 12+, while SCScreenshotManager requires
  macOS 14. The port uses SCK on 14+ and preserves xcap/CoreGraphics on 12–13;
  Windows retains xcap. This is an API availability constraint, not a capture
  timing optimization. Only current macOS compiled/running evidence exists.
- **Own windows:** Clicky excludes all its windows because they are controls and
  overlays. Misty contains the user's actual browser/editor workspaces, so the
  port excludes only companion overlays (and temporarily hides them under the
  capture guard). Excluding all Misty windows would erase the requested content.
  Validation: native filter source and guard ownership; live SCK image reached the
  model, but overlay exclusion still needs a foreground fixture inspection.
- **Coordinate system:** reference NSPanel uses bottom-left AppKit points. Misty
  samples CG points and its webview uses a top-left origin. Preserve the reference
  image-to-display scaling; do not copy an AppKit Y flip into this coordinate
  system. Existing geometry tests cover mixed origins; hardware run pending.
- **Async ownership:** reference MainActor Task is adapted to generation IDs,
  AbortController and a Rust RAII guard. The blocking capture worker owns the
  guard until acquisition finishes even if its async waiter is dropped. This
  avoids clearing exclusion while native pixel acquisition is still active.
- **Provider transport:** the reference supports streaming/upload transcription
  and separate ElevenLabs output. The user's explicit Realtime/Live direction
  justifies native audio through the existing gateway. The voice model has no
  tools: the application submits the finalized transcript to Misty's authorized
  backend, then creates audio only from an owned completed invocation. The live
  synthetic adapter proves native audio and the silence boundary; desktop
  equivalence remains unverified. The old mini-TTS 404 was not hidden with a
  different provider or a fallback rate.
- **Recovery:** transport idle timeout is reset by bytes/heartbeats, not a total
  task timeout. Individual microphone/transcription/capture/TTS/playback stages
  are bounded. Durable actions are never automatically re-submitted.
- **Privacy:** retain metadata/checksums and scoped synthetic artifacts. Do not
  copy Clicky's transcript/image-related telemetry or raw provider body logging.

## Attribution

The ScreenCaptureKit companion implementation is adapted from
`vendor/clicky/leanring-buddy/CompanionScreenCaptureUtility.swift`; the orchestration,
response and pointing behavior follows the files listed above. Clicky is
Copyright (c) 2026 Farza, MIT. The full applicable notice remains in
[the vendored license](../vendor/clicky/LICENSE). The pre-existing deletion of
root THIRD_PARTY_NOTICES.md was preserved; this attribution is additive.

## Final validation boundary for this pass

The running model answered a newly captured display without tools, but dev1 was
controlled in the background and the actual foreground was Codex. Its refusal to
read a tiny preview was appropriate. This is image delivery evidence, not accurate
fixture reading or pointing acceptance. The Mac later locked; CUA explicitly
requires manual unlock. No lock or permission bypass was attempted.

The model input helper now uses the pinned SDK's tagged `FilePart` with inline
base64 data and a preceding coordinate/provenance label. A pinned WorkflowAgent
and MockLanguageModelV4 test verifies the exact decoded bytes at the provider
interface. The actual remote provider's received bytes are not independently
logged; live interpretation and persisted API bytes are separate evidence.

Metadata-only evidence is in [companion-capture-evidence.json](fixtures/companion-capture-evidence.json).
The latest capture decodes to 1280×827, 176473 bytes, matches its native SHA-256,
and includes display ID 1 and captured_at 1790498775788. Historical captures had
valid JPEG pixels/hashes but no timestamps/display IDs. No pixels or prompts are
saved in this artifact.

Limits: 24 MiB invocation JSON, at most 16 displays, 1 MiB decoded per capture,
1–4096 dimensions; native output uses maximum 1280px JPEG. Strict companion
validation currently decodes JPEG/PNG; native producers emit JPEG. Arbitrary
WebP display captures are rejected (ordinary attachment handling is unchanged).
Hosted frontier model selection filters vision capability; the current instance
model's live response demonstrates vision for this installation only. Arbitrary
BYOK models' capabilities are operator assertions, not independently verified.

Stage bounds: 50s transcription, 20s native capture waiter (8s per macOS still),
60s admission, 45s connection/read idle with three bounded resumptions of the same
invocation, 50s TTS, 10s playback startup, 20s without playback progress. These do
not impose a total timeout on a live task. Heartbeats retain approval waits;
server runtime reconciliation remains responsible for missing terminal callbacks
(`ai_runtime_recovery.go`). Its live fault-injection behavior is unverified.

| Acceptance scenario | Evidence | Remaining |
|---|---|---|
| Fresh visual question / no action | running invocation completed with one SCK image, no task/tool events | foreground fixture recognition |
| Accurate POINT | parser/scaling/negative-origin/nonfinite tests; live tag produced | actual target alignment, Retina/multiple displays |
| Authorized fixture action | permission-aware executor retained; historical browser tools ran | controlled Count 0→1 action, blocked by locked desktop |
| Typed/voice parity | shared submission, final-transcript ordering tests | real microphone and indicator observation |
| Repeated/changed view | duplicate-recording and late-result tests; each typed follow-up captures again | live BLUE LANTERN→GREEN HARBOR freshness |
| Cancellation | STT, capture, speech, account logout, stream/startup unit coverage | physical recorder and native restoration faults |
| Provider failures | exact live TTS 404→502; fixture STT/model error paths; retained text and speech-only retry tests | successful configured TTS, live playback failure/slow-model injection |
| Stream disconnect / live wait | cursor resume/deduplication, stalled read/startup, pending-read abort, heartbeat approval wait tests | runtime kill/missing terminal callback against running desktop |
| Capture guard | worker owns guard; current native build passes; one live capture returned | permission denial, timeout, overlap, display removal |
| Account/device isolation | account-scoped positive admission and negative attachment tests | cross-account/device live negative test |
| Stacking | browser/Search rendered and restored; independent suspension tests | active task, simultaneous overlays, worker hit testing |
| Platform parity | current macOS build and limited run | macOS 12–13, Windows, multimonitor hardware |

## Running versions and reproducible checks

Server rebuilt with `misty server up --detach`; API/runtime/postgres/tunnel healthy
at 09:11:56 UTC. API image 77b6950130d5 and runtime image 3d0c4ae24dca. dev1 native
process started 09:03:09 UTC after the native bridge rebuild; React is served by
the development watcher. The final API build includes the no-display-context
prompt clarification; no server restart remains outstanding.

From repository root, start the existing profile with `misty desktop dev --profile dev1`
if it is not running. Rebuild local server with `misty server up --detach`.
Serve the controlled page with
`python3 -m http.server 8769 --bind 127.0.0.1 --directory docs/fixtures` and open
`http://127.0.0.1:8769/companion.html`. Ask for the visible label/point without
clicking, then explicitly ask for one click and verify Count changes exactly once;
change the label and repeat. Keep dev1 foreground for desktop capture.

Checks run: 100 focused frontend tests; root TypeScript; 21 focused runtime tests
including actual pinned multimodal conversion; runtime TypeScript; targeted Go
companion/voice/device-context/tool-projection tests in three packages; macOS
`cargo check --manifest-path src-tauri/Cargo.toml --lib`; focused ESLint. See ledger
for check failures outside functional acceptance and final reruns.

## Native audio direction clarified on 2026-09-27

The user clarified that the intended voice model should handle speech-to-speech
or speech-to-text through Realtime/Live. This supersedes selecting a replacement
standalone TTS model. Native recording, authenticated session, backend handoff,
streamed playback and the sibling billing policy are implemented and rebuilt in
the development services. This is still not full desktop acceptance.

| Route | Audio behavior | Fit for this companion |
|---|---|---|
| OpenAI Realtime through the current AI Gateway | Native audio input/output, optional input transcript, tools, explicit commit/response control | Selected implementation direction for the current hold/release gesture; existing provider route verified |
| GPT-Live | Continuous full-duplex audio frontend with backend delegation; images go to the backend | Possible later conversational mode; its lifecycle differs from the current manual turn contract and gateway availability is not established |
| Transcription-only | Produces text for the existing agent | Valid speech-to-text path, but cannot by itself replace the failed speech output stage |

References checked against current official documentation:
[Realtime](https://developers.openai.com/api/docs/guides/realtime),
[Live](https://developers.openai.com/api/docs/guides/live),
[Live delegation](https://developers.openai.com/api/docs/guides/live-delegation),
[transcription](https://developers.openai.com/api/docs/guides/realtime-transcription).
The gateway route is established separately by the pinned SDK source and a live
synthetic probe, not inferred from direct OpenAI API compatibility.

The intended turn is: native microphone PCM → authenticated, server-owned
Realtime session → final input transcript → fresh desktop capture → existing
Misty invocation (explanation or permission-aware action) → confirmed backend
result in that same voice session → audio playback and existing point/text UI.
Screen pixels and action authority stay in the existing backend pipeline.
Capture remains after finalized speech as in Clicky. The explicit user direction
justifies departing from Clicky's separate transcription/Claude/ElevenLabs chain;
equal-or-better desktop behavior has not yet been verified.

Concrete implementation boundaries and the required billing dependency are in
[the native audio migration plan](plans/companion-native-audio.md).

### Provider validation (not desktop acceptance)

On 2026-09-27 at 16:11:50 UTC, a synthetic 1.415-second locally synthesized PCM
question was sent through `openai/gpt-realtime-2.1` using the installation's
existing gateway credential, kept server-side. The gateway issued a short-lived
token; the session returned a final input transcript, selected one fixture tool,
accepted its fixed result, and produced 1.4 seconds of PCM whose output transcript
contained the expected label. No real microphone, screen, browser action, or
account data was used. Provider audio was counted/hashed and discarded; speaker
playback was not tested. See [metadata evidence](fixtures/companion-realtime-evidence.json)
and [repeatable diagnostic](../server/apps/agent-runtime/scripts/probe-companion-realtime.mjs).

Two details discovered by the probe must be retained in the application:

- Use `turnDetection: { type: 'disabled' }` with the pinned SDK and confirm the
  effective provider session has `audio.input.turn_detection: null`. The SDK's
  OpenAI mapper drops a top-level normalized `turnDetection: null`, leaving VAD
  enabled. The first probe observed `speech-started`; the corrected probe did not.
- Do not generate an audio response before confirmed backend completion. The
  exploratory diagnostic used a text-only tool-selection response; the shipped
  relay is stricter and does not request any response until an owned completed
  invocation is supplied. The voice model has no action tools. The synthetic Go
  adapter test verifies audio follows the confirmed result; HTTP/session tests
  exercise the ownership and completion checks.

The authorized sibling billing change adds the exact Realtime model and split
text/audio/cache/transcription token policy. Missing provider counters retain a
reconciliation hold; known usage uses the durable outbox. Real isolated-database
billing and authenticated-route tests pass. The development API remains on its
existing billing adapter `none`, so commercial charging was not activated.

The live Go provider adapter also passed with 60,000 bytes of reply PCM and
complete measured counters: [metadata](fixtures/companion-realtime-adapter-evidence.json).
The Mac remains locked; native microphone/speaker/pointing acceptance is blocked.

## WebRTC and autonomous actions (2026-09-27 revision)

Ctrl+Option down begins native microphone capture; release stops capture and
commits one turn. A new press interrupts output and starts a new owned turn.
The server advertises WebRTC only when `MISTY_REALTIME_API_KEY` is configured.
The desktop creates an `RTCPeerConnection` with a native-PCM-fed audio sender and
a remote audio receiver. Misty's single-use authenticated control socket relays
SDP; the server creates the OpenAI call and attaches a sideband connection. All
provider credentials and usage accounting stay server-side. VAD is disabled;
input is cleared before ready and committed only after the native media queue
drains. Backend work still uses Misty's existing task/tool executor, and the
voice model reads its completed, owned reply. This is a duplex media transport
with push-to-talk interaction, with a new connection per turn.

If WebRTC is unavailable, call setup fails, or ICE fails before submission, the
client uses the existing AI Gateway realtime WebSocket. Buffered native input
can move to that fallback once, before commit. There is no automatic replay after
commit or backend submission. A voice failure while waiting for the backend
closes only voice; the task continues. Completed text stays in the conversation,
and output can start a fresh voice session using the existing invocation ID.
Provider completion and WebRTC playback completion are separate: the sideband
waits for the output buffer to stop, then the client drains its receiver tail.
Stop closes both media directions, local queued audio, and the control session;
the server cancels outstanding output and hangs up the provider call.

Agent tool actions no longer wait for per-action approval in the registry,
browser, SDK, conversational, or automatic workflow paths. Companion turns use
the normal agent executor rather than a regex-selected tool-less executor.
Account/Space/connector authorization, device ownership, fresh target validation,
argument schemas, cancellation, and effect journals still apply. Historical
approval records and compatibility endpoints are retained; they are not invoked
for new tool actions. Team/Auto controls describe interaction style, not action
permissions. No capability is implied when its actual executor is unavailable.

Configuration: put the server-side OpenAI key in
`server/.env/dev/integrations/ai.env` as `MISTY_REALTIME_API_KEY`, then restart the
dev API with `misty server up --detach`. Production loads the corresponding
`server/.env/prod/integrations/ai.env`; self-hosted Compose exposes the same
variable on the API only. Keep the existing gateway key for fallback. The key
is optional; without it the active media path remains WebSocket. Do not paste
keys into source, diagnostics, or chat.

Protocol references: [OpenAI WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?voice-api=realtime),
[push-to-talk](https://developers.openai.com/api/docs/guides/realtime-conversations),
and [server-side controls](https://developers.openai.com/api/docs/guides/voice-server-controls).
