# Native Misty Agents: implementation and acceptance record

## Delivery status

Implemented across `misty`, `misty-apps`, `misty-sdk`, and `misty-server`. The desktop production bundle builds, and the automated checks below pass. **Release acceptance is incomplete:** no live Notion/Instagram conversation or real parallel native-window session has been verified. Existing unrelated working-tree changes were retained.

## Implemented behavior

- Agents are native navigation/runtime features. The default Misty identity survives alongside private personal profiles. Legacy Agents routes enter the native destination; new installs and package builds do not require the Agents mini-app.
- Profiles have names, avatars, responsibilities, instructions and model preferences. Per-Space assignments start empty and resolve only installed apps. Saving profile and assignments is atomic and checks the current profile version. Chat supports listing, creating, updating and deleting profiles, including model and avatar preferences.
- Conversations bind owner, agent and Space. Memory supports listing, explicit remembering, editing and forgetting. Agent/Space context is filtered by assignments; shared Spaces do not expose other users' profiles, conversations, memory or receipts.
- Native requests use model-selected tools rather than keyword-based action admission. User mode permits assigned reads, chat drafts and explicit agent/memory management. App writes require user activation of Agent or Team mode. Runtime configuration writes cannot expand assignments.
- A process-wide coordinator owns local leases, queues and worker windows. Server leases expire after 25 seconds; local leases expire after 30 seconds. Assignment, account, agent, task, window and scope checks occur independently of model decisions, including at device dispatch.
- Team windows have independent renderer/navigation state and webviews while reusing integration profile IDs. A worker takes queued tasks by acknowledgment; setup failures leave the request queued. Separate requests are queued, while active-conversation corrections can be selected ahead of them. Switching the main window to User mode does not revoke independent Team work.
- Follow-ups first pause execution, then use a read-only model decision to route correction, independent request, or stop. Routing failures leave work paused. Late decisions cannot resume a task that the user stopped again. Corrections resume the same conversation with fresh task authority and prior action receipts.
- Configured destinations remain discoverable when closed. Browser inspection, semantic actions, visual capture, normalized pointing, task-attachment uploads and download receipts are connected to native execution. Files resolve in the host, not in integration JavaScript. File selection is explicitly distinguished from verified website upload.
- Supplied images, PDF, text, CSV, JSON and DOCX attachments are supported within size limits. DOCX inspection extracts bounded body text; it does not reproduce the document's visual layout. Downloads become ready only after native completion confirms a file exists.
- Closing a worker, explicit pause/stop, expired authority and lost execution prevent continued dispatch. Paused pages unlock for human login; resumption is explicit. Activity projects lost execution as paused, not successful. Stop does not claim to undo completed writes.

## Migration and SDK

The additive `20270207000000_native_personal_agents.sql` migration preserves surviving identities and conversation/attachment/run records, adds private assignments and execution leases, and scopes memory/conversations to agents. It does not recover agents deleted by historical migrations. Integration account/profile identifiers and existing Space configurations remain unchanged.

The SDK exports personal-agent, task and artifact contracts, `misty.ai.open({ agentId })`, configured browser destination registration, and pointing contracts. The legacy downloadable-agent transport is deprecated and retained for older clients. Public SDK archives, consumer lockfiles, server snapshots and generated routes were synchronized. See the sibling SDK's `docs/native-agents.md`.

## Automated evidence

| Check | Result |
| --- | --- |
| Host TypeScript and desktop production build | Pass |
| Targeted host suites | 29 files, 99 tests pass |
| Public SDK build/typecheck/tests | 31 files, 98 tests pass |
| Packed SDK consumer without private source/workspace links | Pass |
| Mini-app TypeScript and provider suites | Pass; 46 tests |
| Server HTTP API/Postgres unit packages and router compilation | Pass |
| Isolated database migration/contract checks | Pass; ownership, unchecked assignments, atomic saves, version conflicts, scoped memory, lease revocation, receipts, lost-execution activity and surviving Misty compatibility |
| Native browser tests on macOS | 34 tests pass |
| Native coordinator tests | 4 tests pass |
| Server generated contract checks | 82 routes verified; snapshot matches public package |
| Isolated Windows capture-module compilation | Pass with Tauri 2.11.3, WebView2 0.38.2 and Windows 0.61.3 |
| Scoped roster/editor visual review | Disabled contrast and neutral selection resolved; keyboard-focus visibility remains open |

The database checks used a separate `misty_native_agents_test` database; the active development database/services were not reset or restarted. The visual captures render the actual React editor with synthetic profiles and assignments, not a live backend or native execution session.

Two broader checks remain failing outside the new agent suites: a Files navigation expectation in `useGlobalMistyResults.test.ts`, and the pre-navigation dependency scan expecting `react-filerobot-image-editor`. They were not changed to mask failures.

## Remaining release acceptance

1. Run conversational setup, cross-app Planner/Notion work, and Instagram image upload/draft verification against configured test accounts on macOS and Windows.
2. Verify two real Team windows, original login sessions, file attribution, main-window isolation, login handoff, paused-worker reopening, sleep, exit and restart.
3. Verify native visual capture/pointing and uploads on actual WKWebView/WebView2 pages, including stale targets, failed uploads and uncertain writes.
4. Verify conversation-bound corrections and queue delivery through live model services, including multiple messages arriving during an active task.
5. Finish the roster's keyboard-focus correction/review. Global CSS suppresses the newly declared focus ring/outline; the independent review remains **fix**, not pass. A further review round was requested under the Impeccable procedure.
6. Run full Windows compilation and native acceptance on a Windows runner. Full cross-compilation on this Mac stops in `ring` because Windows C headers (`assert.h`) are unavailable. The isolated capture-module check is narrower evidence.

Native macOS UI automation was blocked by the locked computer. No live account changes, Instagram publications, or Notion writes were performed during acceptance testing.

Queues are local to the running host process; unstarted queue entries are not persisted across app exit. Existing invocation history and write receipts remain available for explicit recovery, but this is not a durable offline scheduler. UI and native end-to-end behavior must not be described as release-validated until the checks above are complete.

Schedules, event triggers, cloud execution, agent handoffs, shared agents, generated image/video services and new Space-template features remain outside this release.
