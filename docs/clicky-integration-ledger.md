# Clicky integration audit ledger

Audit started 2026-09-27. Scope: the vendored Clicky source and Misty's desktop,
React, API, runtime, provider, and native-browser companion paths. The starting
working tree contains extensive unrelated and in-progress edits; those are
preserved. Existing patches are **not runtime-verified** by their presence.

Statuses: suspected, reproduced, fixing, verified, blocked. Verification must
state its level (source, automated fixture, live server, running desktop).
“Known issues” covers audited paths, not undiscovered defects.

### CK-022 — Desktop takeover, natural task flow and Ask (P1, fixing)
- User clarification, 2026-09-28: a fleeting floating cursor did not establish
  visible desktop actions. The intended interaction is an agent taking control
  of the screen, with no concurrent human navigation interfering with its task.
- Evidence: companion submissions force `normalTabs: true`; those actions use
  the native embedded-browser bridge. `MistyAutopilot.m` only sends NSApp events
  to the key Misty window. `MistyCompanionCapture.m` uses ScreenCaptureKit still
  images on macOS 14+, not a running SCStream during control.
- Correction: CK-021's live fixture establishes embedded-browser automation and
  panel completion only. It does not establish system-wide control, external
  browser control, visible native input, or continuous screen capture.
- Implemented: task-bound SCStream capture, normalized native mouse/keyboard
  dispatch, persistent bottom Stop strip, human-input filtering, Escape/voice
  interruption, stale-snapshot/foreground checks, and independent lease expiry.
  Both typed main-window chat and companion voice can attach desktop tools.
  Context never silently falls back to a hidden browser when native access fails.
- User clarification: remove Team/Auto choices; the model chooses when work needs
  control. UI now has one Ask switch, default off and account/device persisted.
  Legacy mode values use one server policy. Ask uses a native human confirmation
  before input/capture ownership, and times out without control or action.
- Exact native errors now appear in the bottom controls and companion status;
  “Agent access: Off” was replaced with an optional page-context attachment UI.
- Automated: 69 focused frontend tests passed (controller, local task ownership,
  context updates, controls, conversation UI, protocol and panel completion),
  plus 7 Agents page tests. Tests include a delayed native Stop during a new voice
  turn, successor-safe pause, Ask default/persistence, desktop context identity,
  no forced Misty focus/overlay, and completion release. TypeScript, scoped ESLint,
  native Objective-C syntax/cargo check and targeted Go tests passed; final native
  and Go reruns recorded below if additional changes occur.
- Live attempt, 2026-09-28 about 07:46 UTC: a fresh conversation requested
  `Misty desktop verified` in the external Zen local fixture. The desktop tool
  reached the native controller and failed with missing Accessibility for dev1.
  Independent UI inspection showed Count: 0 and an empty input. This proves the
  failure boundary, not input dispatch or SCStream acceptance. Initial still
  capture succeeded. No live desktop success is claimed yet.
- User authorized adding dev1 Accessibility and completed Touch ID. System
  Settings independently shows the exact dev1 app enabled. The development
  runner's direct exec inherits its host's macOS permission attribution; a
  LaunchServices launch attributes requests to dev1. The signed bundle is now
  running directly against the development frontend on port 5175. The normal
  CLI launch path still needs a permission-attribution fix; no broader host
  permission was granted as a workaround.
- Live continuation, 2026-09-28 about 08:03 UTC: the direct launch reports missing
  Screen Recording before submitting the fixture task. System Settings shows
  dev1's separate Screen & System Audio Recording switch off. Authorization to
  enable it has been requested and remains pending. The implementation disables
  audio capture. The external synthetic fixture was reset and independently
  observed at Count: 0, BLUE LANTERN, empty input. No desktop action success is
  claimed. An earlier Count: 8 came from intervening user interaction, not an
  agent completion, and is not verification evidence.
- Final automated reruns: TypeScript and scoped diff whitespace checks passed;
  the native workspace-autopilot Rust test passed (1 test), as did targeted Go
  companion/desktop/workspace/browser tests. The signed native build completed
  successfully before this live permission check.
- Remaining live verification: actual external-app navigation/type/click,
  persistent capture/control indicators, input exclusion, Escape/Stop, Ask
  accept/decline, expiry and completed-task release. Multimonitor and Windows
  desktop takeover are not established by this implementation or local fixture.

## Current checkpoint — completion and browser actions, 2026-09-28

CK-021 is fixed and verified in the running dev1 app: finished tasks no longer
pin the empty composer or retain browser suspension. A live typed companion
request navigated, filled an input, clicked once, inspected the result, and
saved its answer through the existing internal MCP/native browser bridge.
[Evidence](fixtures/companion-browser-action-evidence.json) records the completed
invocation and tool journal. The fixture showed Count: 1 and the exact entered
phrase, the panel released automatically, and Search was available afterward.
19 focused tests, TypeScript, and scoped ESLint pass. External-browser action
adapters and the earlier live WebRTC/pointing checks remain outstanding. This
does not claim the complete earlier failure-injection matrix is verified.

## Previous delivery state — native audio follow-up, 2026-09-27

Implemented in Misty and the explicitly authorized sibling `misty-billing`:
native 24 kHz microphone chunks, server-owned authenticated Realtime sessions,
final transcript → fresh capture → existing backend invocation, verified reply →
streamed native audio, cancellation/playback ownership, and measured token billing.
The companion uses `openai/gpt-realtime-2.1` through the same AI Gateway; it no
longer calls the unavailable mini-TTS model. Other legacy voice clients remain.

Automated/provider verification: 13 transport/playback tests, 17 controller tests,
2 native resampling tests, focused Go race tests, full billing race suite and
billing vet. Explicit isolated PostgreSQL runs passed account/hold/settlement
replay, journal recovery, and real HTTP authentication/device/revocation/ticket
replay checks. The real HTTP/database fixture also rejects foreign and unfinished
invocations, strips POINT from the owned saved reply, emits exactly one successful
audio response and closes all four session journals. The live Go adapter produced 60,000 bytes of reply PCM with complete
usage and no speech before the confirmed synthetic result. See
[adapter evidence](fixtures/companion-realtime-adapter-evidence.json).
Frontend TypeScript, scoped ESLint and formatting pass. The earlier repository
source-size gate failure remains; a passing full repository check is not claimed.

Deployed development containers (all healthy):

| Service | Image prefix | Started UTC |
|---|---|---|
| API | `9870430e6254` | 2026-09-27 17:29:44 |
| Agent runtime | `ba0f8c166feb` | 2026-09-27 17:29:41 |
| Billing | `3fe8f7ffbc8e` | 2026-09-27 17:27:02 |

The existing dev1 watcher rebuilt the native app (observed process 21018), and
serves frontend changes. Local and public API checks return 401 for an unauthenticated voice ticket and
426 for a non-WebSocket connection. The default Python user agent initially
received Cloudflare 1010; an explicitly identified verification client reached
the expected API responses. No security rule changed. The deployed schema is
20270927130000, and the real API runtime role has SELECT/INSERT/UPDATE access to
the new journal. Native source changed at 17:19:50 UTC and the dev1 executable
was rebuilt at 17:20:12 UTC.
The API retains `MISTY_BILLING_ADAPTER=none`; this integration does not activate
commercial charging or alter the billing writer setting.

**Blocked desktop acceptance:** CUA still reports the Mac locked and requires
manual unlock. No native microphone/speaker run, exact fixture pointing,
authorized Count 0→1 browser action, repeated native turns, or full overlay
failure recovery has been verified for this build. The user has been asked only
to unlock the Mac; independent implementation/tests/rebuilds continued. Windows
hardware remains unavailable. Unknown provider usage requires operator
reconciliation; it is not automatically reconstructed after a lost connection.

## Initial issue register (historical baseline; current status below)

Each entry below includes the required fields. Source locations and evidence
will be refined during discovery; hypotheses are not established causes.

### CK-001 — Capture/audio startup and context parity (P1, suspected)
- Entry points/platforms: macOS push-to-talk; typed companion; follow-up; ordinary
  composer; external apps; browser and worker windows; other supported desktops.
- Reproduction: Ctrl+Option, ask about a controlled screen; repeat after changing
  it. Compare Clicky's launch/down/up/frame/audio/model timeline.
- Observed/expected: user reports microphone but no apparent ScreenCapture
  indicator; expected source-backed Clicky timing and usable fresh visual input.
- Evidence/source: user report; `vendor/clicky/leanring-buddy/CompanionManager.swift`,
  `CompanionScreenCaptureUtility.swift`, `BuddyDictationManager.swift`;
  `src/features/agents/companion/CursorCompanionController.tsx`,
  `src-tauri/src/infra/cursor_companion/host.rs`.
- Root cause: unconfirmed; inspect all session owners before drawing conclusions.
- Dependencies: permissions, native runtime, model vision support.
- Proposed fix: reconstruct reference, port appropriate lifecycle and provenance;
  validate image bytes/geometry at each boundary without logging content.
- Verification: none yet. Residual limitations: all platform/UI behavior unverified.

### CK-002 — Unattributed 502 / partial answer (P1, suspected)
- Entry points/platforms: voice and companion API/proxy/STT/runtime/tools/SSE/TTS.
- Reproduction: locate reported attempt using request/invocation/task IDs; inject
  isolated upstream failures on controlled requests.
- Observed/expected: raw 502 and partial browser-tool execution versus attributed
  failure, preserved answer, visible recovery, and terminal lifecycle.
- Evidence/source: user report; `server/internal/platform/httpapi/ai_cursor_companion.go`,
  `server/apps/agent-runtime/workflows/space-task-agent.ts`.
- Root cause: unconfirmed; status alone does not identify upstream.
- Dependencies: accessible historical logs and authenticated runtime.
- Proposed fix: trace boundaries, correct established failure, bounded safe retries.
- Verification: none yet. Residual limitations: historical origin unknown.

### CK-003 — Account-scoped browser context authorization (P1, suspected)
- Entry points/platforms: browser context in all companion invocations.
- Reproduction: account-owned attached device/browser without a bound Space;
  negative tests with foreign account/device and invalid attachment.
- Observed/expected: prior obsolete bound-Space rejection; expected account-scoped
  invocation with device ownership, attachment, leases and approvals enforced.
- Evidence/source: existing patch in `ai_invocation_device_contexts.go`.
- Root cause: previously identified obsolete constraint; deployment unconfirmed.
- Dependencies: authenticated live server.
- Proposed fix: preserve security checks and verify deployed behavior.
- Verification: none yet. Residual limitations: patch not runtime-verified.

### CK-004 — Capture guard and overlay restoration (P1, suspected)
- Entry points/platforms: native display capture, all desktop overlays.
- Reproduction: success/failure/cancel/timeout/repeated or overlapping captures.
- Observed/expected: prior hiding without CaptureGuard; expect overlays restored
  and capture flag cleared for every exit path.
- Evidence/source: existing patch in `src-tauri/src/infra/cursor_companion/host.rs`.
- Root cause: prior missing guard; other race conditions unconfirmed.
- Dependencies: CK-001, native desktop.
- Proposed fix: verify ownership, cancellation, and restoration.
- Verification: none yet. Residual limitations: patch not runtime-verified.

### CK-005 — Turn ownership, errors, cancellation, speech (P1, suspected)
- Entry points/platforms: all companion requests, retry/hide/stop/logout/rapid turns.
- Reproduction: interrupt each stage and fail STT/model/SSE/TTS/playback separately.
- Observed/expected: prior hidden error/fade, stall, partial finish; expect visible
  useful error, retained text, retry/stop, no stale state or duplicate actions.
- Evidence/source: existing controller/root patches; Clicky manager and TTS client.
- Root cause: unconfirmed beyond prior visibility patch.
- Dependencies: CK-001/002, stage completion events.
- Proposed fix: explicit operation ownership and progress-aware recovery.
- Verification: none yet. Residual limitations: patched visibility unverified.

### CK-006 — Browser stacking and overlay controls (P1, suspected)
- Entry points/platforms: Search/Misty overlays, active tasks, native browsers,
  worker windows, hot reload.
- Reproduction: open/close multiple overlays while browser/tool work is active;
  exercise click targets and ensure browser restoration.
- Observed/expected: native browser covered panel except header; expect accessible
  controls and independent suspension reasons.
- Evidence/source: existing `GlobalMisty.tsx`, `BrowserRuntimeBridge.tsx`, Rust browser patches.
- Root cause: prior task exemption / coupled suspension reasons; remaining unconfirmed.
- Dependencies: native desktop runtime.
- Proposed fix: verify stacking and reason ownership.
- Verification: none yet. Residual limitations: patch not runtime-verified.

### CK-007 — Visual questions incorrectly enter action loop (P1, suspected)
- Entry points/platforms: typed/spoken screen questions and explicit actions.
- Reproduction: ask what a synthetic page shows, then separately request a safe click.
- Observed/expected: prior request selected browser tools and ended partially;
  expect fresh-image explanation/pointing versus permission-aware explicit action.
- Evidence/source: user report; runtime workflow and companion invocation context.
- Root cause: unconfirmed intent/context orchestration.
- Dependencies: CK-001/002/003.
- Proposed fix: share lifecycle while distinguishing explanation and action.
- Verification: none yet. Residual limitations: model/tool behavior unverified.

### CK-008 — Capture geometry, image integrity, pointing (P1, suspected)
- Entry points/platforms: multi-monitor/Retina/negative origins/display removal,
  browser zoom/scroll; all image/model/POINT boundaries.
- Reproduction: synthetic labeled target, resize and negative display origins;
  inspect decoded dimensions, MIME, timestamp, display and metadata checksums.
- Observed/expected: no established defect yet; expect coordinate space of the
  actual image seen by the model and no stale/invalid targets.
- Evidence/source: Clicky overlay, Misty host/protocol/runtime image serialization.
- Root cause: unconfirmed.
- Dependencies: CK-001, model vision and platform availability.
- Proposed fix: source comparison and geometry/integrity regression fixtures.
- Verification: none yet. Residual limitations: no runtime image delivery evidence.

## Evidence and delivery rules

Keep screenshots, base64, prompts, tokens, secrets and unrelated personal content
out of logs. Use synthetic fixtures and metadata-only diagnostics. Distinguish
implemented, tested, deployed and verified in the running app. Document exact
unavailable permission/environment checks and continue independent work.

## Discovery evidence — 2026-09-27, first pass

- **CK-001 reproduced (source):** Clicky's `CompanionManager.start` refreshes and
  polls permissions and warms TLS. `requestScreenContentPermission` takes a
  320×240 still. `handleShortcutTransition` starts dictation only;
  `BuddyDictationManager.startRecognitionSession` opens its selected provider,
  installs an AVAudioEngine input tap, then starts audio. Key-up stops audio and
  finalizes the provider. The finalized transcript invokes
  `sendTranscriptToClaudeWithScreenshot`, which **then** acquires all displays,
  submits labeled images, parses the reply and plays speech. Repository-wide
  Swift search finds no SCStream owner, startCapture, capturesAudio or
  captureMicrophone. SCStreamConfiguration is used with SCScreenshotManager,
  not a persistent stream. No reference app is running here; indicator behavior
  is still unverified, and permission-test capture is distinct from interaction
  capture. Misty currently captures in parallel with upload transcription after
  key-up; xcap 0.9.8 uses CGWindowListCreateImage on macOS. These are unexplained
  divergences to fix, not evidence of parity.
- **CK-002 reproduced (live server metadata):** At 08:12:58 UTC transcription
  succeeded (request `desktop_c6a18b3a-757a-49ff-a179-888d074228e3`, after auth
  refresh). Invocation `invocation_8d38e81e-4081-4147-a430-f02263d4c5a4`, runtime
  `wrun_01M3GYSDVWWBJFZC0AXCGS70XC`, task
  `36831ee7-4274-42e4-ae3f-809030fa0a91` completed at 08:13:22 with an 868-character
  assistant message and two display captures. Speech request
  `desktop_e54d2a6e-3e65-4d6e-9260-64d23eccc2bc` then returned 502 in 144ms.
  A synthetic call with the installation's existing gateway credentials and
  exact speech protocol at `/v4/ai/speech-model` reproduces upstream **404
  model_not_found for openai/gpt-4o-mini-tts**. No provider was changed. Historical
  upstream response was not logged; present reproduction establishes the
  configuration defect, not byte-for-byte historical upstream evidence.
  A separate `/v1/misty/agent-followup` request
  `desktop_91a05fbb-8909-4f7f-8ce1-e5e2535e2edc` returned 502 at 08:13:38; origin
  remains under investigation. Gateway model availability is an external blocker
  for successful speech with the current configuration; requested only the
  intended speech configuration from the user.
- **CK-007 reproduced (live event metadata):** Earlier invocation
  `invocation_025c3431-bca0-442f-a504-70dfc663244e` ran 08:06:19–08:09:58 with
  browser.inspect, visual, click, inspect, click, visual, discovery, click,
  inspect; last inspect failed, then a partial-answer terminal event arrived.
  This was active execution, not a dead SSE connection. Tool-specific failure
  details and whether the original request authorized these actions still need
  inspection; prompts and screenshots are not emitted in this ledger.
- **CK-005 reproduced (source):** Speech API sends `speech_generation_failed`
  but frontend maps `voice_speech_failed`; typed Agents submissions bypass
  controller capture/speech/point ownership; stream-error callback overwrites
  already streamed text. Reader retries EOF but has no read-idle deadline.
- **CK-008 reproduced (source):** API accepts arbitrary nonempty base64 such as
  the test's literal `jpeg`; dimensions and SHA-256 are never checked. Display
  identity/timestamp are dropped by serialization. Native captures are valid
  JPEG producers, but that does not validate historical delivery.
- **CK-004 additional race (source):** guard lives in the async waiter, whereas
  spawn_blocking capture can outlive cancellation. Dropping the waiter restores
  overlays and clears the flag while pixels are still being acquired.

All findings above remain short of full running-app acceptance.

## Current status — 2026-09-27, implementation and controlled run

| ID | Status | Implemented / automated evidence | Running-app evidence and remaining acceptance |
|---|---|---|---|
| CK-001 | fixing | Shared typed/voice controller; transcript-finalized capture ordering; macOS SCScreenshotManager port; capture timestamp/source/display ID retained. Ordering, duplicate native events, and typed capture tests pass. Native build passes. | New SCK capture admitted at 08:46:17. Foreground was Codex, not background-controlled dev1; model correctly described its preview. Actual foreground/microphone/indicator check requested from user, still pending. |
| CK-002 | blocked | Safe speech provider status and request/invocation/model diagnostics; actionable frontend error. No provider/model changed. | Exact current gateway route returns 404 model_not_found for configured openai/gpt-4o-mini-tts, exposed as speech 502. A synthetic same-provider openai/tts-1 probe succeeded, but sibling billing policy only prices the configured model explicitly; changing runtime alone would misbill. Intended configuration/restoration required. Separate historical follow-up 502 remains unattributed. |
| CK-003 | fixing | Existing removal of obsolete Space check preserved. Negative attachment/scope/privacy/Space tests retained; runtime still resolves device ownership before exposure. | Account-scoped live requests admitted, including original browser execution. Cross-account/device live negative checks remain unverified. |
| CK-004 | fixing | RAII guard moved into blocking acquisition so async cancellation cannot restore overlays early. Native compilation succeeds; controller cancellation discards late pixels. | Rebuilt app completed SCK capture and continued showing controls. Native failure/timeout/overlap/display-removal restoration still needs fault-injected desktop acceptance. |
| CK-005 | fixing | Stage deadlines; one turn owner; pending read abort; SSE idle reconnect from last event ID; partial text retained; speech failure preserves answer/point; speech-only retry; stalled playback timeout. 100 focused frontend tests pass, including cancellation, logout and duplicate turns. | Visual answer completed and speech failed with useful attribution. Successful audio playback and live failure matrix remain blocked/unverified. |
| CK-006 | fixing | Existing independent suspension reasons and task-exemption removal preserved; focused GlobalMisty tests pass. | Controlled browser page plus Search overlay rendered with all controls accessible; closing restored page. Active-task/worker/multiple-overlay/hit-testing matrix incomplete. |
| CK-007 | fixing | Narrow explanation intent route shares capture lifecycle but creates no task/tools. Runtime and API both prevent tools for direct explanation. Explicit actions retain executor/lease/approval path. | Invocation cac9008e completed with no tool events and a POINT marker, execution_mode=user. Paired authorized fixture click still pending. Non-English/ambiguous requests retain executor with explanation policy in prompt. |
| CK-008 | fixing | API decodes image, validates dimensions/MIME/hash; pinned WorkflowAgent/MockLanguageModelV4 test proves identical decoded image bytes, labels and timestamp at model boundary. | Original requests' JPEG bytes/dimensions/hashes validated from stored payloads. New capture has metadata. Accurate foreground pointing, zoom/scroll freshness and multi-monitor hardware checks remain unverified. |

Controlled run: invocation `invocation_cac9008e-2186-4aa6-ba74-81a11e61ac09`,
admission request `desktop_85d63cb4-8eec-496b-acfc-5c307b9c947c` at 08:46:17,
completed 08:46:31 without tools; one display image. Its response identified a
small preview and declined to guess unreadable text. Speech request
`desktop_da22507d-f52f-4e1a-b3db-523fb2a7d61d` failed at 08:46:32 with logged
upstream_status=404 and code=speech_model_unavailable. The first diagnostic's
request ID was empty because it read chi context; fixed to use the actual
sanitized X-Request-ID header. That final logging edit still needs redeployment.

The original partial request was an explanation request (solution to a visible
puzzle), establishing unintended tool selection. Its last inspect failed and
its terminal event explicitly reported partial completion. No matching persisted
SDK/MCP audit row was found for that time interval. Container recreation has
removed the original API log window. Do not invent a tool failure reason.

### CK-009 — Lost tool identity in failure/completion events (P2, reproduced)
- Entry points/platforms: durable runtime tool events, all desktop platforms.
- Reproduction: complete or fail a browser tool; inspect projected SSE event.
- Observed/expected: failed tool named `tool.failed` (historical call
  `call_zqWDg4kYDPyti1I2GH5fJ4uM`); expect actual canonical tool identity.
- Evidence/source: `ai_invocation_runtime_completion.go` reconstructs tool name
  from phase, but workflow changes phase to `working`/`tool_failed` on completion.
  Canonical tool identity is already present in checkpoint output.tool.
- Root cause: incorrect projection field, reproduced in stored event metadata.
- Dependencies: authenticated runtime callback (unchanged).
- Proposed fix/status: fixing; prefer output.tool for terminal tool events and
  preserve the phase-based fallback for legacy/start events. Test without raw
  provider/tool content. Residual: cannot recover missing historical details.

## Final implementation checks and blockers

- CK-001/005: active normal-tab companion follow-ups now reacquire desktop images
  through the controller after pausing the task. Screen-referencing worker
  requests explain unavailable desktop context rather than using stale history.
  Requests with no supplied displays receive an explicit no-desktop-context
  system instruction. Capture after transcript, capture/admission cancellation,
  bounded startup and playback progress remain owned by the turn.
- CK-004: macOS 12–13 retains the existing xcap/CoreGraphics path because Misty's
  declared minimum OS is 12.0 and SCScreenshotManager is available only on 14+.
  Newer macOS uses the direct SCK still port; Windows retains xcap. Native check
  passes; current dev1 process rebuilt at 09:03:09 UTC. Older hardware unavailable.
- CK-005: failed speech preserves the completed text and point; Retry companion
  synthesizes the same completed invocation only. A short cursor status points to
  Agents for recovery after the point finishes. Final live status-label rendering
  is blocked by the locked Mac, despite renderer regression coverage.
- CK-008: [metadata evidence](fixtures/companion-capture-evidence.json) records
  three actual invocations, decoded JPEG sizes and matching hashes; newest image
  includes timestamp/display ID/source. Pinned SDK conversion preserves exact
  fixture bytes. Actual remote-provider byte telemetry is deliberately not added.
- CK-009: terminal projection now reads canonical output.tool, with legacy phase
  fallback. Regression passes; final server deploy includes the fix. Historical
  missing error detail cannot be recovered from current stored public events.
- Tests: 100 focused frontend tests passed; root and runtime TypeScript passed;
  21 runtime tests across five files passed; targeted Go tests passed in httpapi,
  agents, and unit packages; current macOS cargo check passed (existing native
  deprecation warnings). Focused ESLint passes after routing cross-feature
  imports through a small public companion entry point. Scoped diff check clean.
- Test invocation corrections: direct unconfigured vitest initially lacked
  aliases/jsdom; official `npm test -- ...` wrapper resolves this. The first SDK
  test assumed old raw file data; it now verifies V4 tagged data. A diagnostic
  string expectation was corrected to the established safe error. All corrected
  focused tests pass; these initial failures were not runtime acceptance.
- Live blockers: CUA reports “Mac is locked and automatic unlock could not unlock
  it”; user asked to unlock and foreground the fixture. Real mic shortcut/audio
  indicators, correct foreground pointing, safe action and all native fault
  injections cannot currently be completed. The reference app is not running;
  do not present its source-derived timing as observed indicator behavior.
- Speech blocker: configured gateway model is unavailable. Same-provider tts-1
  returned audio in an isolated synthetic diagnostic, but adopting it requires
  an intended-model decision and coordinated billing policy outside this repo.
  No provider, credentials, billing policy, or active model was silently changed.
- Follow-up 502: historical response is known, exact cause is not. The handler
  can fail on provider transport or invalid route JSON. Neither is asserted as
  the historical cause. Existing paused-task recovery remains intact.

### CK-010 — Repository source-size gate remains red (P2, reproduced)
- Entry points/platforms: repository-wide source-size architecture contract.
- Reproduction: `npm test -- src/tests/architecture/sourceSize.contract.test.ts`.
- Observed/expected: 61 files exceed/mismatch the current baseline; expect the
  architecture gate to pass. The starting tree already has many oversized files
  (HEAD companion controller 544 lines, native host 563); this pass adds controller
  and test coverage, yielding 639 and 647 lines respectively. GlobalMisty and
  useMistyStore also participate in the existing oversized-file set.
- Evidence/source: contract output at 09:05:56 UTC; exact controlled file paths in
  `sourceSize.contract.test.ts`. Full-tree diff whitespace checks additionally
  report pre-existing CRLF changes in unrelated runtime/BYOK files; scoped changes
  here pass whitespace validation.
- Root cause: repository-wide baseline/refactoring debt plus growth in cohesive
  companion orchestration/tests. No baseline was increased to hide it.
- Dependencies/proposed fix/status: reproduced; structural extraction is still
  needed, with unrelated file cleanup kept outside this runtime audit. This is
  an explicit validation failure, not a passing full-suite claim.
- Residual: focused functional tests do not imply the repository check is green.

End-to-end completion is **not established**. Implemented, automated, deployed,
and actually observed evidence are separate throughout this ledger.

2026-09-27 native-audio follow-up: the user explicitly authorized edits to
misty-billing. Billing started clean, with no applicable AGENTS.md found in it or
its ancestors. Integration, tests and development rebuilds are complete as
recorded at the top of this ledger; native desktop acceptance remains blocked.

Earlier deployment follow-up (superseded by the current table): `misty server up --detach` completed successfully
after the no-display prompt clarification; API/runtime/postgres/tunnel all report
healthy. Final GlobalMisty public-entry-point rerun passes all 8 tests. Server
source is deployed; the remaining acceptance blocker is runtime configuration
and access to the unlocked desktop, not a missing server restart.
Earlier container metadata: API image `77b6950130d5`, started 09:11:56 UTC; runtime
image `3d0c4ae24dca`, started 09:11:52 UTC.

### CK-011 — Intended native audio route differs from the installed chain (P1, reproduced)
- Entry points/platforms: companion voice input and spoken replies, all platforms.
- Reproduction: inspect the current voice routes; the user clarified that the
  intended model should handle speech-to-speech or speech-to-text through a
  Realtime/Live model. Current recording upload → transcription → text agent →
  separate TTS does not provide a native speech-to-speech session.
- Observed/expected: the unavailable mini-TTS route still prevents spoken
  completion; expect a supported native audio route through the existing gateway,
  with screen reasoning and actions delegated to the authorized Misty agent.
- Evidence/source: `agent_voice.go`, `agent_voice_speech.go`, `media_search.go`;
  pinned AI SDK 7.0.66's gateway Realtime V4 implementation. A scoped synthetic
  probe on 2026-09-27 successfully minted a short-lived token for
  `openai/gpt-realtime-2.1`, opened the gateway WebSocket, and received
  `session-created` and `session-updated`. That first handshake did not validate
  effective manual turn detection; see CK-012 for the corrected configuration.
  No microphone, screen, or user prompt was sent by that handshake probe.
- Root cause: product intent/configuration mismatch. A Realtime model cannot be
  substituted into the existing `/speech-model` request: it needs a session,
  audio events, response ownership, cancellation and usage accounting.
- Dependencies: authoritative session ownership and metering. User authorization
  now includes `misty-billing`; its exact Realtime token policy is implemented.
- Proposed fix/status: fixing — implementation and development deployment done,
  native acceptance blocked. `audio.rs`/`host.rs` stream sequenced 24 kHz PCM;
  `companionVoice.ts` owns transport and `companionVoicePlayback.ts` playback;
  `agent_voice_realtime*.go` owns tickets, authenticated handoff and billing.
  The voice model has no tools; only an owned completed invocation can start
  output. Screenshot timing and existing account/device/approval checks remain.
  Live's full-duplex lifecycle would be a separate product change.
- Verification/residual: the 16:11:50 UTC synthetic probe completed a 1.415s PCM
  question → final transcript → one fixture tool/result → 1.4s PCM reply with
  the expected label. [Metadata](fixtures/companion-realtime-evidence.json) and
  [diagnostic](../server/apps/agent-runtime/scripts/probe-companion-realtime.mjs)
  are saved; no raw audio, transcript or token is persisted. Script syntax and
  metadata assertions pass. No desktop playback, billing admission, or full
  companion acceptance is claimed. This supersedes
  the earlier request to choose a replacement TTS model; native audio is the
  intended direction, without silently switching providers or billing rates.
- Delivery state: native/session/backend/playback integration and billing policy
  are implemented and rebuilt in development. The live Go adapter confirms the
  actual application provider transport; real HTTP/DB tests prove ticket/device
  isolation and replay denial, and billing store/journal tests prove accounting
  boundaries. [Implementation and rebuild details](plans/companion-native-audio.md).
  This does not replace unlocked desktop acceptance. CUA reports the Mac locked.

### CK-012 — Normalized null does not disable Realtime VAD (P1, reproduced)
- Entry points/platforms: native audio route; all gateway/OpenAI clients using
  the pinned Realtime codec.
- Reproduction: send `turnDetection: null` with the pinned normalized session
  config, then append synthetic audio. Initial probe received `speech-started`.
- Observed/expected: automatic VAD remained enabled; expect manual commit and no
  autonomous response generation for the hold/release companion gesture.
- Evidence/source: OpenAI provider's `realtime/openai-realtime-event-mapper.ts`
  checks `config.turnDetection != null` and therefore omits null. Its explicit
  `type: 'disabled'` branch writes the actual provider `turn_detection: null`.
- Root cause: mismatch between the normalized type's documented null behavior
  and pinned mapper serialization, confirmed in source and provider events.
- Dependencies/fix/status: fixing; diagnostic and application adapter now use
  explicit disabled mode and verify the effective provider session before
  accepting input. Live synthetic adapter and protocol tests pass. No
  node_modules patch was made; native gesture acceptance remains blocked.
- Verification/residual: corrected live synthetic probe confirms effective null
  and zero speech-started events. No native shortcut/runtime acceptance yet.

### CK-013 — Prompt-only speech gating is insufficient (P1, reproduced)
- Entry points/platforms: Realtime backend delegation, all platforms.
- Reproduction: ask the voice model to call a fixture tool and speak only after
  it returns while leaving audio output enabled for the first response.
- Observed/expected: initial probe generated audio before the tool result;
  expect no unconfirmed result or action claim to be spoken.
- Evidence/source: initial 16:10:36 UTC synthetic run returned two audio-done
  events and input/output audio tokens on its pre-result response despite the
  explicit instruction. Only synthetic content was involved.
- Root cause: a behavioral instruction is not a transport/authorization gate.
- Dependencies/fix/status: fixing; the exploratory diagnostic uses text-only
  tool selection. The application has no voice tools and requests no response
  before an account-owned completed backend result. Session tests reject early
  output and unowned/incomplete replies; the live Go adapter verifies the
  confirmed-result audio boundary. Native action acceptance remains blocked.
- Verification/residual: corrected run received audio only after the fixture
  result, with one audio-done event. This is synthetic provider evidence; it does
  not establish real action authorization or safe interruption in the app.

### CK-014 — Low-rate microphone resampling and chunk continuity (P2, fixing)
- Entry points/platforms: new native PCM path on macOS/Windows, devices below
  24 kHz and devices whose sample rate is not an integer multiple of 24 kHz.
- Reproduction: feed one second at 8/16/44.1/48/96/192 kHz, then compare a 44.1 kHz
  signal drained in small chunks with the same signal converted in one pass.
- Observed/expected: naive downsampling cannot produce correct low-rate output
  or retain phase across chunks; expect exactly 24,000 frames and identical bytes
  at chunk boundaries. This was a pre-deployment implementation finding.
- Root cause/evidence: conversion needs absolute source/output frame positions,
  not a per-chunk ratio. Source: `cursor_companion/audio.rs::pcm_since`.
- Dependencies/fix: absolute frame indexing, downsample bucket averaging,
  low-rate sample duplication, invalid-format rejection; no network in callback.
- Verification: both native tests pass. The watcher rebuilt the application.
  Residual: real device audio quality/dropout and Windows hardware unverified.

### CK-015 — Missing usage counters and interrupted completion (P1, fixing)
- Entry points/platforms: Realtime provider usage and server/billing settlement.
- Reproduction: omit counters while retaining empty detail objects; disconnect
  after commit/response start; interrupt between final decision and settlement.
- Observed/expected: absent integer fields must not silently become measured zero;
  an interrupted final decision must survive for idempotent outbox delivery.
- Root cause/evidence: Go scalar decoding conflates missing with zero; settlement
  needs a durable decision before release/charge. Sources: `voice_realtime_usage.go`,
  `agent_voice_realtime_session.go`, `postgres/voice_usage.go` and billing policy.
- Dependencies/fix: explicit required counters, sum/cache validation, measured
  cancellation usage, journal-before-complete, stable settlement keys, pending
  completion recovery; unknown usage retains the hold and records `reconcile`.
- Verification: Go race/protocol tests reject ambiguous counters and settle late
  cancelled usage; isolated billing DB tests reject cross-account/conflicting
  settlements; journal test recovers known decisions and holds unknown work;
  real ticket test proves failed setup closes its unused-session journal.
- Residual: lost upstream counters need operator reconciliation. The local API
  does not enable commercial billing, so a real customer charge was not tested.

### CK-016 — Invalid playback chunk could defeat empty-output detection (P2, fixing)
- Entry points/platforms: new streamed WebAudio playback.
- Reproduction: append one invalid odd-length PCM byte, catch its error, then
  finish. The byte count must still represent no accepted output.
- Observed/expected: mutating the count before validation let rejected data count
  toward completion; expect a visible failure for no valid audio.
- Root cause/evidence: `companionVoicePlayback.ts::append` updated bytes too early.
- Dependencies/fix: validate nonempty/even/bounded PCM before changing counters.
- Verification: playback tests cover signed PCM, sequential scheduling, rejected
  input, interruption, stalled clock and missing completion. All five pass;
  the related eight transport tests pass. Residual: actual macOS speaker and
  autoplay behavior await the unlocked desktop.

## Implementation gap review — 2026-09-27 follow-up

The core pipeline is implemented, but desktop acceptance is not the only work
remaining. This source review does not mark the following behavior as fixed.

- **CK-005, reproduced in source — voice loss during backend work:**
  `CursorCompanionController.tsx:232` routes a voice error to `fail` when playback
  has not started. `fail` calls `interrupt`, which cancels the owned invocation.
  Reproduction path: finalize speech, start a backend invocation, then close the
  voice connection before backend completion. Expected: preserve the running
  backend/text result and allow speech-only recovery without replaying actions.
  Root cause: voice transport failure shares the whole-turn cancellation path.
  Proposed fix: distinguish explicit user stop from loss of the voice transport;
  retain invocation ownership and test disconnect during execution/approval.
  Status: fixing, remaining implementation. Native reproduction still blocked.
- **CK-015, confirmed missing recovery workflow:** `RecoverVoiceUsage` retries
  `settlement_pending` only. `reconcile` rows retain their holds indefinitely
  without a voice-specific operator resolution tool, alert or provider-session
  correlation record. Repository search confirms only journal writes/recovery
  and tests. Expected: discoverable, auditable reconciliation of unknown usage,
  with verified counts or an explicit operator decision. Do not guess charges.
  Proposed work: preserve safe provider identifiers, expose pending work and
  provide an idempotent operator resolution path. Provider-side lookup support
  must be established before promising automatic reconstruction.
- **CK-007, reproduced predicate gap:** direct execution of the current
  `isCompanionExplanation` returns false for "Help me understand this screen."
  and "¿Qué significa este error en mi pantalla?". Both enter the tool-capable
  route; the Spanish phrase also misses ordinary-composer screen-reference
  detection. Root cause: narrow English regular expressions. Existing executor
  permissions remain enforced. Proposed fix: stronger intent/context routing,
  including natural paraphrases and multilingual fixtures, while preserving
  explicit action authorization. This is predicate evidence, not a live tool run.
- **CK-010, remaining implementation cleanup:** current controller/test/native
  host sizes are 605/640/599 lines. The changed companion files still need
  cohesive extraction to satisfy their size limits without raising baselines;
  unrelated existing architecture failures remain separate.
- **Scope coverage:** `useAiVoiceRecorder.ts:128` still uploads a completed blob
  to the legacy transcription route. Only companion voice was migrated. The
  Realtime adapter is gateway-only with a fixed model/voice; full-duplex Live,
  other provider adapters and a unified voice route for every composer are not
  implemented. These are scope extensions if desired, not proof that the chosen
  push-to-talk contract is absent.

### CK-017 — Realtime failure correlation is incomplete (P2, reproduced in source)
- Entry points/platforms: new Realtime setup, input, backend wait and output.
- Reproduction: fail token mint/socket setup, or send a normalized provider error
  before the completed reply is submitted.
- Observed/expected: setup sends a generic client error; later failures log only
  operation ID and generic text. Expected: privacy-preserving correlation from
  native turn/request through voice operation, invocation and provider session,
  plus safe upstream status/code and stage timing.
- Evidence/source: `agent_voice_realtime.go:125`,
  `agent_voice_realtime_session.go:83`/`:231`/`:338`, and
  `agents/voice_realtime.go:24`. Invocation correlation currently begins at reply;
  provider session IDs are not retained by the relay/journal.
- Root cause: the new protocol has partial diagnostics, not the complete
  correlated failure trace requested by CK-002.
- Dependencies/proposed fix: carry nonsecret correlation metadata, preserve
  allowlisted provider status/codes, record stage timings and expose safe error
  references. Never log audio, images, prompts, credentials or raw error bodies.
- Status: fixing, remaining implementation. Verification: source call-path and
  repository search; live failure attribution still needs fault injection.

### 2026-09-27 — Revised interaction and autonomy contract
The user now prioritizes a bidirectional WebRTC media connection, transport
fallbacks, and removal of agent approval prompts. Ctrl+Option down starts input;
release commits it; the next press interrupts output and starts a new turn.
This supersedes the earlier request to preserve per-action agent approvals.
Account/device ownership, OS access and execution idempotency remain applicable.
Clicky's reference uses a staged audio pipeline; WebRTC is an intentional departure.

### CK-018 — WebRTC transport and fallback (P1, source reproduced, fixing)
The current companion streams PCM over a gateway WebSocket. It does not establish
an RTCPeerConnection. Add actual duplex audio tracks, server-owned call setup and
control, and a gateway WebSocket fallback before input is committed. Never replay
a submitted turn or completed tool operation during transport recovery. Preserve
the text answer when output fails. Direct OpenAI WebRTC credentials are currently
absent; the configured gateway supports the existing WebSocket protocol. Live
WebRTC validation therefore remains separate from fixture verification.

### CK-019 — Agent approval gates (P1, source reproduced, fixing)
Registry, browser, SDK and workflow paths still contain approval/intent gates.
Remove first-party per-action approval prompts and intent-based tool withholding
under the user's revised contract. Preserve resource ownership, connector/account
access, argument validation, device targeting and effect journals. Verify actions
execute without review prompts while cross-account access remains denied.

### CK-020 — Existing workflow test counter races under `-race` (P2, reproduced)
The broad server unit run on 2026-09-27 found concurrent unsynchronized `calls++`
in `server/test/unit/workflows/engine_test.go:102`, in
`TestForEachRunsBoundedChildGraphAndCollectsItemErrors`. The companion/transport
packages passed the race detector. This unrelated test fixture needs an atomic
counter; it is not evidence of a voice transport failure. Left outside this change.

### CK-021 — Completed companion task pins an empty panel (P1, verified)
- Entry points/platforms: desktop companion completion and Global Misty overlay.
- Reproduction: finish a companion request, then click Close Misty. Reproduced
  in the running dev1 app on 2026-09-28; the empty composer stays visible after
  Close, while the saved answer and companion Ready state are already visible.
- Expected: a completed task releases the forced panel and browser suspension;
  the answer and retained browser context remain available for follow-ups.
- Root cause: `GlobalMisty.tsx` forces `taskSurface` open for any local execution,
  including `finished`; `searchAvailability.ts` also treats finished as active.
  `settleLocalExecution` intentionally retains the finished execution context.
- Fix: only running/paused executions force task controls or block Search.
  Explicitly opened conversations remain open and close normally.
- Status: verified in regression fixtures and the running dev1 desktop.
  Two new regression tests failed before the fix; all 19 focused panel/Search/
  browser-context tests pass afterward, along with TypeScript and scoped ESLint.
  Tests retain the finished task and explicitly opened conversations, release
  browser suspension, allow Close/Search, and retain paused-task recovery.
- Live verification: a fresh Agents composer request used the shared companion
  executor to navigate to a local page, fill its Verification phrase, and click
  BLUE LANTERN once. CUA independently observed `Count: 1` and
  `Entered: Misty browser verified`, a saved completion answer, Companion Ready,
  no pinned panel, and a usable Search launcher. The tool journal confirms
  completed browser actions through the existing internal MCP/native bridge.
  See [runtime evidence](fixtures/companion-browser-action-evidence.json).
- Residual limitations: the first fixture run was interrupted around a dev
  reload and recorded an unknown click outcome. The successful run started a
  fresh page/task with no source edits during execution. External Chrome,
  Safari, and Zen tabs have screen capture but no companion action adapter;
  their control is not implied by the built-in browser verification.

### 2026-09-27 — WebRTC/autonomy verification update
- CK-018: implemented actual duplex audio tracks, server-authenticated SDP call
  creation, sideband control, call hangup, explicit manual input control, media
  playback drain, and one pre-submission gateway fallback. Fixture tests cover
  call credentials/SDP, sideband failure cleanup, native PCM-to-sender routing,
  remote speaker attachment, ICE timeout, pending-release fallback, cancellation,
  and rejecting PCM replay inside an established WebRTC session. Live provider
  WebRTC remains unverified until `MISTY_REALTIME_API_KEY` is configured.
- CK-019: automatic per-action approval gates removed from shared registry,
  browser, SDK, conversational and workflow execution. Legacy approvals remain
  readable. No new tool action requests one. Companion questions retain tool
  availability and enter the same owned executor as action turns. Team/Auto are
  interaction styles. Account/Space rights, device/target ownership, valid
  schemas, cancellation and effect journals remain enforced.
- CK-005: voice failure while the backend is running now releases only voice.
  Regression verification confirms the backend is not cancelled or submitted
  again and its completed reply can use a fresh output session.
- Verification: 38 focused frontend tests and TypeScript passed; relevant Go
  unit packages passed with `-race`. Real HTTP/MCP tests on a fresh, isolated
  migrated PostgreSQL database passed: voice account/device/ticket replay and
  billing journal; autonomous browser click/interact with sleep/resume and exact
  effect replay; SDK backend cross-app writes; all 21 browser/Planner scenarios
  including changed account/body/recipient/destination, cancellation, device
  revocation, lost result, stale snapshot, sign-in, and uncertain-effect recovery.
  The isolated database was dropped afterward. No real messages were sent.
- Development API and agent runtime rebuilt successfully and report healthy.
  WebSocket remains the active provider transport without the Realtime key.
  This update does not close the earlier pending real-desktop capture/pointing
  checks, repository size cleanup, or operator reconciliation diagnostics.
