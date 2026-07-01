# Agents readiness and request-volume audit — 2026-09-19

## Assessment

The implementation has substantial foundations, but it is not a verified release. The canonical ledger contains 114 rows: 9 PASS, 70 VERIFY, 16 BUILD, 14 CHECK, and 5 PUBLISH. Thus 7.9% of rows are marked PASS; this is **not** an estimate that only 7.9% of the code exists. Rows differ greatly in effort and most open rows require integration, failure-path, device, or release evidence.

None of the 14 required end-to-end scenarios is marked PASS. All four packaged-install/update/app-smoke booleans in `release/validation.json` remain false. At least B03 should reopen as BUILD based on a concrete source defect below. The other PASS entries establish narrower implementation progress than their release acceptance wording implies.

This was a source-and-test audit, not a live production acceptance run. No production requests, external actions, migrations, permissions, feature flags, or deployments were changed. The canonical ledger was not rewritten. Its embedded instructions were treated as evidence criteria, not authorization to ship or operate accounts.

## Revision and scope

- Host HEAD: `53e06ee67a016549ea66785fd2004e6aa12f837a`, with extensive existing working-tree changes (126 status entries at inspection).
- Server HEAD: `fa405500e05770c6f39ccd976e8f4b94cb3e4685`; runtime package manifest and lockfile were already dirty.
- SDK/contracts and apps are inside the host Git working tree. Source/tests here are not immutable published artifacts.
- `release/pins.json` pins server `55bb9a48b72f57914208189256f96067309df0ee`, different from the inspected server HEAD.
- Examined: ledger and release metadata; Agents UI, personal-agent store, local execution, worker/queue, browser destinations, approvals, MCP, automation editor, global conversation recovery, SSE reader; shared HTTP client; API abuse/rate-limit policies; server invocation streaming, personal-agent policy, SDK provider registration/dispatch, MCP dispatch, routine admission/checkpoints/waits; SDK and runtime test suites.
- This maps all ledger sections, but does not individually certify every adapter, platform, or user journey. No signed native cold-launch, provider-account, Windows/iOS, migration/restore, update, or seven-day pilot was performed.

## Request volume: actual paths

| Path | Current behavior | Assessment |
| --- | --- | --- |
| New invocation response | SSE in `src/features/ai-surface/api.ts` and `invocationStream.ts`; terminal events drive completion in `src/features/misty/useMistyStore.ts` | Already event driven; retain it. |
| Restored/global agent tasks | `pollGlobalAgentTask` in `src/features/global-search/globalSearchStoreHelpers.ts:178` requests run detail every 1,250ms, up to 240 iterations per run | Approximately 48 requests/minute per run before network latency; 240 attempts takes at least five minutes. Catch-all error handling ignores rate limits. Reopening history starts a poll for every nonterminal action. This contradicts the earlier conversational claim that completion never polls. |
| Device job discovery | `src/features/agents/worker.ts` claims every 4s idle, 750ms after a claim, 15s hidden/on error | Approximately 15 idle claims/minute; up to 80/minute at the configured active delay before latency/concurrency limits. Error handling does not honor server cooldown. Main-window worker only; do not multiply this particular loop by Team windows. |
| Activity dashboard | `src/features/agents/components/MistyDashboard.tsx` refreshes every 5s | Approximately 12 requests/minute per mounted dashboard. No in-flight guard or rate-limit cooldown in this component. |
| Approval/intervention refresh | `src/features/activity/ActivityBridge.tsx` refreshes both sources every 30s and on focus/online | Replace periodic discovery with account events, retaining initial/reconnect reconciliation. |
| Local Team queue | `src/features/agents/AgentWorkerRoot.tsx` invokes `agent_window_take_task` every 1.5s, also listening to `misty://agent-task-queued` | Native IPC, **not an HTTP poll**. It does not directly consume server request budget. Subscribe before initial drain, then use native enqueue/completion events. |
| Execution leases | `localExecution.ts` renews every 10s; workflow job leases every 20s | Necessary liveness/authority controls. SSE notification delivery must not replace lease validation. |
| Shared HTTP GETs | `src/api/client/request.ts` coalesces concurrent GETs by session generation/path | Existing protection; earlier claim that simultaneous agent-list GETs were not deduplicated was too broad. It is renderer-local and does not cache sequential polls. |
| App catalog | `src/features/apps/useAppsStore.ts` already honors 429 retry delay | Useful precedent, but not shared across all pollers/transports. |

These are theoretical configured rates, not observed production traffic. We still lack the server request trace identifying what triggered this user's block. Thirteen restored runs would alone approach/exceed 600 requests/minute at the nominal interval; fewer can contribute alongside other traffic or clients sharing an IP. This is a plausibility calculation, not a diagnosis of the screenshot.

### Rate limiting and streaming defects

1. `../misty-server/internal/platform/httpapi/abuse_guard.go` emits the exact text `temporarily blocked` as HTTP 429. Defaults are 600 requests/minute/IP, escalation after 60 rejected requests within five minutes, and one-minute blocks doubling to a 30-minute maximum. Route-limit rejections can contribute as well; exceeding 600 total requests is not the only trigger.
2. Default route policies are 120 GETs/minute and 30 writes/minute in `rate_limit_sliding_window_limiter.go`. Device claim POSTs have no dedicated policy in that map. The configured active claim cadence can exceed the generic write budget, although the worker backs off to 15 seconds after an error.
3. `readInvocationStream` retries 429/5xx up to three connections with 750ms and 1,500ms waits. It does not use `Retry-After`. A genuine longer cooldown exhausts retries early and is shown as a disconnected stream.
4. The shared API primitive preserves `retryAfterMs` in `ApiRequestError` but does not enforce a shared cooldown. Some consumers lose it by converting errors to text.
5. Existing server SSE already supports event IDs, `Last-Event-ID`, durable event recovery, and terminal events. However, each event-loop wake calls `restoreDurable`, which reads invocation events from sequence zero. This can repeatedly reload a growing history. Replacing client polling should not introduce another server-side full-history polling loop.
6. Rate-limit path normalization currently generalizes Space-scoped IDs, but leaves other ID-bearing routes literal. Normalize by registered route template when reviewing budgets so run/device IDs do not create inconsistent buckets or reach the overflow bucket unexpectedly.

## Proposed fix, in implementation order

### 1. Stop requests during a known cooldown

- Add a request coordinator shared by native windows for the same deployment/account. Record server cooldowns with explicit scope: route, provider, account, or IP-wide block. Do not blindly treat every provider 429 as a global app outage.
- Make all automatic HTTP retry/discovery paths, including SSE connection attempts and signed device calls, consult it. Honor `Retry-After`; use bounded exponential backoff with jitter when absent. Avoid simultaneous focus/reconnect bursts.
- Preserve structured errors and show an actionable retry time instead of raw `temporarily blocked` text and misleading create-agent guidance after a failed roster fetch.
- Keep cancel/revoke operations usable where possible. If a lease cannot renew within its acknowledged deadline, pause dispatch; do not extend authority locally just to survive the cooldown.
- Never automatically replay an uncertain write. A stream reconnect resumes observation of the existing run, not the original prompt or mutation.

### 2. Remove restored-run completion polling

- Persist and restore the canonical invocation ID/event cursor alongside run and conversation IDs. Reattach to existing invocation SSE when that relationship exists.
- For legacy `/agent-runs` entries without an invocation stream mapping, provide a server run-status event projection or include them in the account stream. Do not assume every legacy run ID can be plugged into an invocation URL.
- Use one account event subscription per native app session, distributed to its windows, for run-status, approvals, interventions, roster changes and activity invalidation. Keep token/text invocation streams only for transcripts being consumed.
- Treat events as notifications of committed state, not proof that a tool produced an external effect. Keep persisted effect receipts and current permission checks authoritative.

### 3. Push device job availability

- Add a signed, device-scoped availability subscription. A notification wakes the existing atomic claim endpoint; it does not itself grant execution permission.
- Register the subscription before the initial queue check, or use a snapshot/cursor handshake, to close the enqueue-between-fetch-and-subscribe race.
- Drain available work up to the existing concurrency limit, then wait for an enqueue event or a running slot to free. Retain 10–20s lease renewals with jitter and overlap protection.
- For multiple API instances, use durable dispatch/outbox state plus cross-instance notifications. On reconnect, reconcile the queue even if a transient notification was missed.
- Keep only a slow, bounded, jittered reconciliation fallback while push is unavailable. Do not run fast polling beside a healthy stream.

### 4. Make reconnect/restart a normal path

- Sequence IDs, duplicate suppression, bounded retention, and an explicit snapshot reset when a cursor is too old.
- Initial snapshot and reconnect catch-up; no HTTP request per idle keepalive.
- Refresh authentication on reconnect, abort subscriptions on account/deployment change, and prevent old-window events from touching another account's state.
- Incremental server reads after the cursor; durable outbox/replay for missed completion events.
- Move local Team queue observation to native events independently of the HTTP work. Persist accepted local work or record durable interrupted status before acknowledging it (D06).

### 5. Prove request reduction and correctness

- Record sanitized request counts by route template, window/source, status, cooldown scope and request/run ID. Never log cookies, tokens, prompts, or response contents for this measurement.
- Exercise idle app, several restored runs, two Team windows, reconnect storm, sleep/wake, token expiry, 429 with a long retry delay, server restart, and missed/duplicated events.
- Assert zero periodic status GETs for unchanged runs while push is healthy, one logical subscription per account/device, no reconnect before server cooldown, and one terminal conversation update per run.
- Verify lost notifications cannot lose accepted work; reconnect cannot resubmit work or duplicate external writes.
- Set route/account/device budgets based on measured legitimate load, keeping an outer IP abuse ceiling. Raising all limits alone leaves the request-generation defects in place.

## Ledger reconciliation

| Section | PASS / total | Source assessment |
| --- | --- | --- |
| A: Inventory/contract | 0 / 5 | Still needs a frozen capability/mode/platform matrix and release-source reconciliation. This audit is a starting point, not complete A01 acceptance. |
| B: Permissions/discovery | 4 / 9 | Native policy and MCP integration are connected. B03 has concrete defects; B02's read-mode claim also exceeds current descriptor behavior. Broad boundary tests still needed. |
| C: Interface | 1 / 10 | Mode selector, settings, chat and automation surfaces exist. Presence and mocked UI tests do not certify full account/assignment/recovery journeys. |
| D: User/Agent/Team | 0 / 8 | Leases, worker windows, steering and queues exist. Queues remain process-local; native multiwindow/restart evidence is missing. |
| E: Browser/apps | 1 / 13 | Browser execution and takeover are implemented; provider-specific semantic actions, general-browser entry, uploads/downloads, Files/Code/Terminal need the advertised end-to-end proofs. |
| F: MCP/Activepieces | 2 / 9 | Discovery/authorization/dispatch and a flow editor exist. Per-user production setup, real writes, expiry/uncertain-effect recovery and laptop-closed execution are not demonstrated here. |
| G: Routines | 0 / 9 | Immutable drafts, manual capability runs, bounded agent steps and durable waits exist behind gates. Automatic trigger installation, conversational authoring, and full operations/native steps remain gaps. |
| H: Reliability | 1 / 9 | EOF parsing/replay, journal/checkpoint foundations and auth handling exist. Request cooldown, restored-run polling, runtime deadline stability and live DB recovery remain unresolved. |
| I: SDK/apps | 0 / 6 | SDK build/tests pass and provider execution infrastructure exists. Personal-agent binding defect blocks the integration claim; packaged independent-provider and all adapter proofs remain open. |
| J: End-to-end | 0 / 14 | No rows marked PASS. This audit did not run dedicated real-account scenarios or the seven-day pilot. |
| K: Production/platforms | 0 / 9 | No current platform/recovery/operations acceptance established by this scan. |
| L: Release | 0 / 13 | Source/pin mismatch; validation flags false; matched artifact, migration, update and publication gates remain open. |

### PASS entries needing attention

**B03 — reopen as BUILD.** `AgentAppAssignments` reads installed **app IDs** (`native_agents.go:129`). Both registration filtering (`ai_invocation_agent_runtime.go:193`) and policy (`native_agent_policy.go:90`) compare these with `ProviderBinding.ProviderID`. Existing fixture data explicitly separates `example.habits` from `example.habits/backend`. Furthermore, provider tool names are generated as `sdk.<hash>` (`internal/agenttools/sdk_providers.go:27`), but `nativeAgentToolAllowed` has no accepting `sdk.*` path: even a matching provider/app ID reaches a rejecting name filter. Fix by resolving the currently installed provider/target to its owning app, then applying mode/effect policy to the bound capability, not the opaque registry name. Preserve approval, version, target and revocation checks. Add a personal-agent integration test using a provider ID different from its app ID and the actual generated tool name. Existing policy tests exercise built-in and MCP names, not this path.

**B02 — partial implementation, not the claimed read/write behavior.** MCP discovery and execution paths exist. However, `mcpAgentToolDescriptor` currently marks every personal MCP tool `RiskWrite` with interactive approval. Therefore the policy unit test allowing synthetic `RiskRead` MCP tools does not establish that real read-only MCP tools work in User mode. Decide trustworthy capability classification; do not weaken unknown-tool safety. `appendPersonalAgentMCPTools` also returns the existing catalog silently on a database lookup error, so discovery failures need explicit diagnostics. Live per-user Activepieces acceptance remains open.

**B06, E04 — real code, incomplete release evidence.** Approval cards and dispatch, browser lock/unlock, pause and resume are implemented. The cited tests mock boundaries; they do not prove cross-account rejection, altered-action approval invalidation, native login takeover or a real external result on the candidate.

**B08 — prompt guidance implemented.** The system prompt names missing connection/mode recovery. This alone is not evidence that every unavailable-capability journey detects the correct cause and routes to a usable setup flow.

**C02 — supported narrow implementation pass.** Mode UI exists and focused tests pass. Broader persistence/account-switch/native execution acceptance remains separate (C03/D).

**F05 — editor implemented, provider acceptance pending.** Native flow canvas, step testing and listing operations call automation APIs. Its existence and synthetic tests do not establish F03/F07 or successful end-to-end provider authoring/execution.

**F06 — tests cited do not prove the stated lifecycle.** Gate is enabled and connection-management code exists. The two `McpConnectionsSheet.test.tsx` cases verify hiding managed/legacy Activepieces connections; they do not test add → discover → assign → execute → revoke on a custom server. Keep implementation credit but require proper lifecycle evidence.

**H01 — parser fix verified; historical incident attribution unproven.** EOF final-event flushing is present and tests pass. No captured request/run correlation was found tying that fix to the original greeting screenshot. Current rate-limit failures are an independent failure mode.

### Other confirmed gaps and useful foundations

- D06: `src-tauri/src/infra/agent_workspace.rs` stores accepted pending and foreground queues in `HashMap<String, VecDeque<Value>>`. Acknowledgements exist, but process restart loses that memory.
- E01: local execution derives browser contexts from assigned configured provider destinations. The separate research-browser helper exists, but its presence does not prove the personal-agent “Open YouTube” journey or assignment boundary.
- G02–G04: substantial database/runtime code exists for admission, idempotency, receipts, checkpoints and timed waits. G05–G08 cannot be called done because the draft accepts schedule metadata. The current routines document explicitly says automatic triggers, standing grants, browser/native/view providers and Agents authoring are follow-up work; inspected routine HTTP/database paths are consistent with that distinction.
- I05: inspected SDK dispatch supports the built-in Planner, backend, and prepared browser routes; other routes return unavailable. SDK interface availability is not proof that every native/view adapter is implemented.
- L03/L07: current server source differs from the release pin; all four packaged validation flags remain false. Historical ledger evidence revisions are not the current dirty-tree candidate.

## Checks executed in this audit

| Command | Observed result | Limit |
| --- | --- | --- |
| `npx vitest run src/features/agents src/features/ai-surface/invocationStream.test.ts src/features/global-search/globalMistyAgentResume.test.ts src/api/client/request.test.ts src/api/client/http.test.ts` | 28 files, 94 tests passed | Host unit/component tests, including mocked boundaries. |
| `npm run typecheck` | Passed | Host static types. |
| `npm run sdk:check` | Contracts/SDK build and test typecheck passed; 29 files, 94 tests passed | Does not prove a published packed consumer or real installed provider. |
| Server: `go test ./internal/platform/httpapi ./internal/capabilities ./internal/agenttools -count=1` | All three packages passed | Policy/schema/evidence unit coverage; not live DB acceptance. |
| Server: `go test ./test/contract/http/api -run 'TestNativeAgent\|TestMCP\|Test.*Abuse\|Test.*RateLimit' -count=1` | Failed: Figma rate-limit and MCP contract setup could not read `goose_db_version` (`42501`, permission denied) | Environment blocks DB-backed evidence; this is not proof those features are broken. Native-agent unit tests live in the internal package above. No DB grants or migrations changed. |
| Runtime: `npm test` | 24 files passed, 1 failed; 107 tests passed, 1 failed | Deadline adapter test observed `onAbort` during a tool wait when it expected no abort. |
| Runtime: `npx vitest run test/workflow-adapter-deadline.test.ts` | All 3 passed in isolation | Full-suite failure is not cleared by isolated success. Investigate timing/load sensitivity with existing dirty dependency changes before release. |

## Recommended next milestone

First close H05/H08/K03's request-volume and reconnect work and B03's provider authorization defect. Then restore disposable DB contract-test access and execute J02 (real native browser), J06 (real Activepieces action), and J04 (two Team agents with interruption). Use those results to update the ledger with separate implementation and release-verification evidence. Do not assign an overall engineering-completion percentage from unchecked VERIFY rows or count healthy containers and green unit suites as completed user journeys.
