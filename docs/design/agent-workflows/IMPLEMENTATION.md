# Agent workspace implementation

The October 2 implementation keeps the existing Agents directory and adds the approved per-agent workspace around the existing conversation. Approved visual references are in [mockups](mockups); current product and design contracts are [PRODUCT.md](../../../src/features/agents/PRODUCT.md) and [DESIGN.md](../../../src/features/agents/DESIGN.md).

The proposed backend and companion implementation sequence is recorded in [Misty agent architecture and implementation plan](PLAN.md). It unifies the workspace, Cmd+Shift+K panel and voice entry points, and gates cross-member agent messaging behind verified individual-agent work. Phases 1 and 2 now have the implementation and verification evidence below; later phases remain pending.

The original UI implementation was limited to `AgentsPage.tsx`, `components/AgentWorkspaceConversation.tsx`, `workspace/AgentWorkspaceFrame.tsx`, `workspace/AgentWorkspaceCatalog.tsx`, `workspace/AgentWorkLocation.tsx` and the two workspace stylesheets. The root collection remains unchanged. Catalog navigation and in-workspace floating preserve the mounted conversation and draft. Templates seed an unsent draft through the existing guard. New editors use React state only; persistence, scheduling, skill import, connector connection and window execution remain unavailable. Existing conversation, profile, voice and account-connection capabilities are retained.

## Verification evidence

The production-component harness lives at `.impeccable/review/agent-workspace-ui/`. Start it from the repository root with:

```sh
node node_modules/vite/bin/vite.js --config .impeccable/review/agent-workspace-ui/vite.config.mjs
```

It serves actual `AgentsPage` at `http://127.0.0.1:5210` with fixture account data. Fourteen reviewed JPG captures cover the main 1304px layout, 1920px reference comparison, 900px compact layout and 390px fallback. Review concluded SHIP for fidelity and UI-only scope with no material fixes. All 14 screenshot rasters contain provenance metadata; the scan found none missing. No new raster artwork was generated.

The implementation pass reports 41 passing tests across five suites, passing full TypeScript and scoped ESLint checks, and a passing desktop Vite build with chunk-size warnings. Five style detector advisories were accepted for the approved 32px launch, 26px narrow launch and 10–11px metadata scale, now recorded in the scoped design frontmatter.

The original UI evidence above verifies production UI under fixtures and existing mocked tests. It does not establish live account integration, backend execution, native voice/window control or a separate OS window. No new backend, API, native integration or local-storage persistence was added.


## Phases 1 and 2: shared lifecycle and verified folder work

Implemented October 2, 2026 on `polar-browser-caps`. Existing `misty_ask_conversations`, `ai_invocations`, `ai_invocation_events` and `ai_artifacts` remain canonical; no parallel conversation/run tables or migration were added. Unrelated workspace changes were preserved.

### Shared lifecycle

- Agents, the Cmd+Shift+K panel and Talk to Companion use the same selected account/agent conversation, draft attachments and active invocation. Opening a surface preserves a draft and does not start work, record audio or capture the screen.
- Postgres serializes admission per owned conversation. Replayed idempotency keys recover the original invocation; a different concurrent request receives `conversation_busy`. The client retains admission keys after uncertain responses.
- Active-run text and finalized spoken follow-ups use a durable `/ai/invocations/{id}/steering` endpoint. The runtime consumes batches at model boundaries in the same transcript. Receipt keys make boundary replay stable; intake closes atomically before completion, rejecting late input rather than silently losing it. Follow-ups are bounded to 8,000 characters and 40 messages per invocation; attachments stay in the draft for a subsequent task.
- Conversation history projects steering messages, active invocation identity and current unexpired proposals. Reconnect replays saved events without repeating tool effects. Account/agent switches guard async handoff, attachment upload and voice transcription completion.
- Stop audio interrupts capture/playback without canceling business work. Stop task cancels execution. Ordinary speech now responds directly in a persistent realtime conversation; bounded tool requests enter the existing task authority boundary. Task-result narration derives from the saved backend answer.

### Verified folder organization

The new `misty-agent-files` native crate and main-window-only commands execute a small allowlist. A native picker grants one account access to one folder. The model receives visible relative names, file/directory metadata and opaque item IDs, never the native root path or file contents. Existing permission-checked Misty knowledge tools remain in place; no new blanket knowledge access was added.

The proposal supports creating folders and moving/renaming regular files under the granted root. Approval reviews exact source → destination changes. Unsupported operations, hidden items, links, traversal, absolute paths, overwrites, shell execution and directory moves are rejected. System roots and the user's home root cannot be selected. The initial scan is bounded to 500 visible items and eight levels; a plan is bounded to 100 changes. Ambiguous files stay untouched and are described in the proposal.

The native journal persists grants and immutable plans under account ownership. Each step records intent before mutation and a verified receipt afterward. Descriptor-based no-follow traversal and atomic no-replace rename constrain effects. Fingerprints detect changed sources or destinations. A replay reconciles an interrupted move rather than repeating it; ambiguous effects require review. Stop pauses between indivisible operations. Resume uses the same manifest. Undo reverses only verified unchanged moves and removes only the newly created, unchanged, empty directories. Grants can be revoked, while history remains readable. A missing/revoked grant never triggers a replacement grant automatically.

The workspace and popup show the same readable proposal, compact folder control and operation receipt. Pending reviews restore their original device grant after an app restart. Reject remains available after that grant or its pane is removed. Unavailable access displays recovery guidance with Approve disabled, never raw folder-plan JSON. Receipts distinguish completed, paused, partial/review-needed and undone work. Backend account-scoped artifact decisions no longer require an unrelated Space; shared destinations still check current membership.

### Verification recorded

- Frontend: 54 focused handoff, attachment isolation, folder-plan, workspace and companion tests; 19 popup/composer/voice-recorder tests; four recovery-review tests. Voice transport is mocked in these tests.
- Native: three command-policy tests verify main-window-only access; nine disposable-filesystem tests cover nested duplicate names, no-overwrite collision, stale sources, permission-denied items, pause/restart/revoke, immutable plan identity, crash-after-rename reconciliation, changed-destination undo refusal, symlink insertion and replaced roots.
- Server: internal HTTP/Postgres suites pass. Two isolated-Postgres contract tests verify concurrent admission, idempotent steering, completion-boundary closure, account-scoped proposal restoration/approval, foreign-owner denial and duplicate approval refusal. The disposable database uses a test superuser; these tests assert explicit owner checks, not production RLS configuration.
- AI runtime: all 24 test files / 101 tests and TypeScript checking pass, including a follow-up arriving before final completion in the same model transcript.
- Full frontend TypeScript, scoped ESLint, desktop Vite build and native macOS development build pass. Vite retains its existing large-chunk warnings. New UI detector findings: none.
- Live signed macOS dev app: native folder picker selected a synthetic three-file folder; the real model proposed `Notes/meeting-notes.txt` and left two ambiguous invoice copies untouched. The proposal survived an app restart. Approve created `Notes` and moved the note; both receipts verified. Direct filesystem inspection confirmed the paths/content. A frontend reload recovered the receipt. Undo restored the original note path/content and removed the created empty directory.
- Live shared flow: a workspace draft appeared unchanged in the floating panel. A new typed turn started one invocation; a follow-up sent during execution was queued and reflected as three numbered steps in the final answer. Database inspection found exactly one invocation for that turn with one `user.steering` event. Reopening with Cmd+Shift+K retained the conversation; saved history retained the follow-up.
- Visual evidence: `.impeccable/review/agent-phases/desktop.png` and `floating.png`, plus `recovery.png` showing revoked access and disabled approval, actual 1280×820 macOS windows. The finish review and its follow-up assess only the added folder/recovery/shared-control surfaces, not the entire app or backend security.

### Remaining acceptance and limits

The user confirmed typed → spoken → reopened conversation continuity, then reported latency and stuttering. After the persistent realtime follow-up below, the user confirmed the actual microphone and speakers are very fast and smooth. Automated tests supplement this audible acceptance. Native folder execution is implemented for Unix hosts and live-tested on macOS; Windows does not expose the folder action. Folder classification is metadata-based; reading document contents, cloud-file organization and moving directories are outside this slice. An interrupted uncertain operation remains inspectable and requires reconciliation rather than automatic repetition.

Self-hosted Composio, additional browser control, workflow/template persistence, scheduling changes, the full capabilities settings page, and cross-agent collaboration were not added. Their later readiness gates remain open.

The finish reviewer scored both requested fixes resolved: recovery-state readability and the phase-specific documentation update. The ship verdict is limited to those fixes. A final live rejection of an unused proposal also verifies that revoking folder access does not prevent dismissing the review.

### Initial buffering follow-up (October 2; superseded by persistent conversation below)

The reported run used the WebSocket audio relay. Its ticket was issued at 21:40:26 PDT; the provider transport opened at 21:40:34, transcription settled at 21:40:49.826, invocation admission occurred at 21:41:08.123, and the saved answer completed at 21:41:21.832. Speech was requested at 21:41:23. These timestamps identify roughly 18 seconds between settled transcription and admission and 14 seconds for execution, but do not establish microphone release time or isolate capture versus local execution preparation. The existing Normal preset resolved to high reasoning; that product policy was preserved.

Playback now starts with 250 ms of jitter headroom, schedules subsequent PCM contiguously even when a packet arrives within 30 ms of the next start, and increases headroom after an actual underrun (bounded at 750 ms). The playing notification fires once instead of republishing the native companion presentation for every audio delta. WebRTC microphone scheduling also preserves contiguous samples near its scheduling boundary. Saved speech segments prefer sentence endings within the existing 320-byte admission bound; genuinely long sentences still fall back to word boundaries. Per-segment authorization, accounting and verified-result-only speech remain intact.

Typed companion turns prepare the voice transport during admitted execution without starting the microphone or generating speech. Idle setup accepts keepalives while retaining access checks. Client stage diagnostics and server setup/input/transcription/first-audio timings contain durations and identifiers only, never audio, screenshots or prompt text. They will distinguish the remaining delay on the next live check.

Verification: 49 focused frontend tests across five files, including burst jitter, underrun recovery, cancellation and no early speech; Go voice protocol/reservation tests; TypeScript and scoped ESLint pass. The rebuilt local API is healthy. This is not evidence of a measured end-to-end latency improvement or audible speaker acceptance after the patch.

Follow-up startup regression: the manual API recreation omitted the scoped AI environment from Compose interpolation. The service's explicit empty environment overrides masked the key still present in `integrations/ai.env`, so voice ticket admission succeeded but provider setup failed immediately. Recreated only the local API with all saved development environment files; the running API and agent runtime now both have their existing gateway configuration. A temporary probe inside the API container confirmed an actual provider connection and acknowledged manual voice setup in 1,489 ms, without microphone input or speech generation. Probe files were removed. This verifies setup recovery, not the outstanding audio-quality acceptance. Future restarts should use the environment-loading CLI; generic container health alone does not prove provider readiness.


### Persistent realtime conversation and screen awareness (October 2)

The companion now reuses a conversation-scoped Gateway realtime session. Ordinary
spoken or typed companion conversation bypasses the sequential transcription →
high-reasoning invocation → segmented TTS chain. Native audio commit starts the
response while transcription runs in parallel. Continuous PCM playback retains
the jitter cushion. User input is acknowledged durably before the composer clears.

Five bounded voice functions read current evidence or request task start, status,
steering and cancellation. Actions still enter existing ownership, capability,
approval and idempotency checks. Tool admission is not completion. Screen questions
request fresh native captures; ordinary chat does not capture. Completed task
results are read by owned invocation ID, with no tool calls allowed during narration.
Voice holds settle before task handoff, preventing a completed response's unused
reservation from competing with the task or next voice response.

Canonical invocation/event storage records conversational speech without runtime
dispatch. Internal delegated prompts do not duplicate the user's message. Scope
changes, rapid press/release, interruption and stale tool receipts cannot replay
action requests. Session/turn/audio/context/tool/output limits bound resource use;
unknown provider usage remains reconcilable rather than silently discarded.

The user accepted the real microphone/speaker experience as “Very fast and smooth.”
Their two first-audio measurements were 1,398 and 986 ms after server commit, with
827 ms initial setup. A three-turn desktop session measured 1,112 / 916 / 909 ms
and recalled its first prompt from shared history. Synthetic provider tests measured
1,308 / 1,049 ms with no projected playback underruns. These timings are not total
acoustic latency. A live screen request successfully described a YouTube page from
fresh captures of two displays; no clicks or file changes were requested.

53 frontend transport/controller/playback tests, Go protocol/reservation tests,
TypeScript and scoped lint pass. Isolated Postgres tests verify immutable owned
history receipts without task dispatch; authenticated contracts reject foreign
conversations, invalid device access and ticket replay. No development database
migration, account-credit adjustment or billing policy change was made. See the
[current native audio contract](../../plans/companion-native-audio.md) for bounds
and compatibility. Phases 3–4 implementation and remaining deployment gates are recorded in [the execution record](PHASES-3-4.md).

Final screen regression: one persistent session completed both its acknowledgement
and the saved-result narration without a billing admission failure. The native
task described the visible Codex plan and second display; response audio began
at 1,592 ms for acknowledgement and 1,559 ms for result narration after each
server commit. Screen-task execution remains a separate, slower vision task,
not a promise of one-second visual answers. No video/system-audio input was added.

### Browser takeover and workflow restart boundary

Separate-window browser tasks use native leases and the same server invocation/event stream as the main window and voice. Taking over revokes device authority and cancels that invocation; an ordinary browser Resume starts a new invocation in the original conversation with fresh observations. It is not continuation of the original invocation.

A workflow retains its immutable version, inputs, skill versions and last invocation receipt in the local execution record, but automatic Resume and routed follow-ups after takeover are disabled. Users must review completed or uncertain effects before explicitly starting another run. Deterministic continuation across workflow operation receipts is not implemented; instructions alone do not establish safe replay.
