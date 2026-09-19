# Agents and integrations production-readiness ledger

Created: 2026-09-18. Release status: **NOT READY**. This is the canonical completion ledger for the full Agents experience, not permission to deploy or publish.

Initial inventory: **114 open items** — 15 checks/decisions, 24 implementation items, 70 validation items, and 5 publication items. Three are conditional platform/provider items. Use row status as authoritative; these counts are a creation-time snapshot, not a progress percentage.

## Outcome and scope

A user can sign in, select or create an agent, connect accounts, assign capabilities, understand and choose User / Agent / Team mode, run supported work, review consequential actions, follow progress, interrupt or recover work, and retrieve verified results. Supported background integrations and routines continue on the server when the desktop is closed. Local browser work accurately requires an available device. The released application, API, runtime, SDK, app packages, catalog, documentation, and update feed form one verified compatible release.

Preserve the approved Grok-inspired layout and Misty cloud identities. Finish all existing agent-related entry points and execution paths, including paths currently hidden behind flags. Do not count a route, screenshot, mock, healthy container, successful build, or old test report as a completed user journey.

This ledger includes the application surfaces that agents depend on: Browser, Inbox, Social integrations, Files, Code, Terminal, Chat, Journal, Planner, Library, Activity, settings, authentication, installation, and updates. It does not authorize unrelated product expansion, a Marketplace, new shared-agent semantics, or automatic publication to third-party accounts. Zapier is an optional additional provider; finishing the existing Activepieces path is required.

**Platform rule:** macOS is the first release candidate. Existing Windows execution paths must be validated before Windows availability is claimed. Web and iOS/iPadOS must truthfully support or gate each path; their publication requires their own platform gates. Android packaging, extension Marketplace, and unrelated Transfers functionality remain outside this milestone unless scope is explicitly expanded. A hidden unfinished feature remains unfinished; it cannot be called shipped.

## How to maintain this ledger

- Status: `CHECK` = reconcile source/deployment or make a concrete decision; `BUILD` = confirmed missing/disconnected work; `VERIFY` = implementation exists or is reported, but release evidence is missing; `PUBLISH` = release operation not performed; `PASS` = acceptance evidence recorded; `BLOCKED` = named external dependency; `DEFERRED` = explicitly approved scope change with rationale.
- Priorities: **P0** prevents truthful/safe execution or compatible deployment; **P1** completes the promised product; **P2** is conditional on the supported platform/provider. Every in-scope P0 and P1 must pass. P2 is not permission to silently remove an implemented path.
- Section owners are engineering roles, not assigned people. Before starting a row, record an actual owner and reviewer in its evidence entry. `—` means no prerequisite; IDs identify prerequisites. A section dependency applies to every row in that section.
- Break a row into suffixed IDs if work cannot be reviewed independently. Preserve the parent ID and acceptance criterion. Record discovered paths under A01 rather than losing them in chat.
- Move to `PASS` only against the release candidate revision/environment, with the evidence template below. Older reports establish a starting point, not a current pass. Reopen affected passes when their code, schema, contracts, permission model, deployment, or package changes.
- Do not enable flags or weaken authorization merely to make a demonstration work. Uncertain external effects must be reconciled before retrying.

### Evidence required for each PASS

```text
ID / status / verified date:
Owner / independent reviewer:
Host, server, runtime, SDK, apps revisions and artifact digests:
Environment / platform / feature flags / applied migration head:
Test account roles and anonymized configured targets:
Reproduction steps and expected result:
Observed result, including actual persisted or external effect:
Automated command + result / manual steps + result:
Sanitized logs, screenshots, run/effect IDs, report paths:
Failure, interruption, denied-access and recovery checks:
Remaining limitations / release channels covered:
```

Never include bearer tokens, cookies, signing secrets, private message contents, or raw customer data. Use dedicated test accounts. A model saying an action succeeded is not effect evidence.

## Inspected baseline and concrete blockers

The inspected working trees contain uncommitted work; these HEADs are anchors, **not complete release pins**: host `a6695cea`, server `08d5956`, SDK `1cb4977`, apps `4bc0c0f`, website `11d5a1b`. Capture full commits and dirty-tree differences under A01 before implementation and again when freezing the release.

| Finding on 2026-09-18 | Evidence and consequence |
| --- | --- |
| Personal-agent execution excludes integration paths that exist elsewhere. | `nativeAgentToolAllowed` rejects `mcp.*` and `ask.delegate`; `nativeAgentInvocationPolicy` rejects provider bindings. `ai_invocation_agent_runtime.go` drops SDK registrations when `agent_id` is present. B02/B03 must reconcile this explicitly. |
| User / Agent / Team are implemented but poorly discoverable. | Agents settings contain the selector, labeled Discuss and draft / Work in this window / Work in a separate window. Store defaults and account changes reset to User. C02 and D01–D06 apply. |
| Local browser access depends on mode, assigned apps, and configured destinations. | Agents chat supplies no initial browser contexts; `startLocalExecution` adds granted contexts for Agent/Team. Do not assume every missing tool is a model failure. D03/E01 apply. |
| Team queues are process-local. | Rust coordinator queues are in memory; implementation notes explicitly say pending work is not persisted across exit. D06 applies. Team windows are not cloud workers. |
| Activepieces infrastructure is running locally. | Docker inspection reported app, worker, PostgreSQL and Redis healthy. This does not verify per-user connection, discovery, permissions, execution or production deployment. F01–F08 remain open. |
| Custom MCP connection UI is gated off. | `publicBetaAvailability.mcpConnections` is false; the sheet excludes managed Activepieces from custom connections. F02/F06 and L05 apply. |
| Native personal agents and saved routines have conflicting scope boundaries. | Native docs exclude scheduling/cloud/delegation; older managed-Misty docs exclude personal agents; routine APIs exist behind flags. A02 and B01 must establish one contract without exposing legacy authority. |
| A failed greeting remains unresolved. | User screenshot shows a failed `hello` followed by a successful textual answer. Earlier schema normalization fixes do not prove this later failure has the same cause. H01 applies. |
| Development source and deployed API are not equivalent. | Prior recovery retained an older API image to avoid unrelated/unapplied migrations; only the runtime compatibility fix was deployed. L01/L02 are mandatory before broad enablement. |
| Release pins and validation records lag current source. | `release/pins.json` pins different SDK/apps/server commits and still lists an Agents mini-app; `release/validation.json` has all four packaged-install/update/smoke booleans false. L03/L06/L07 apply. |

Recent session evidence: frontend build/typecheck and focused UI suites passed during the redesign; animated WebP metadata and desktop/mobile fixtures were checked; nine local-execution tests passed on 2026-09-18. These are narrow checks using synthetic data or mocked boundaries, not native signed-in release acceptance. Historical implementation documents contain additional passes and failures that must be rechecked against the frozen candidate.

## A. Inventory and product contract

Owner: product + host/backend leads. Gate: G0.

| ID | Priority / status | Work | Acceptance / required proof | Depends on |
| --- | --- | --- | --- | --- |
| A01 | P0 CHECK | Create the authoritative path inventory. | Enumerate host routes/menu entries, SDK methods, API routes/aliases, tool descriptors, adapters, jobs, flags and legacy paths; map each to mode, account/Space ownership, platform, ledger ID and live deployment. No orphan or unclassified path. Record full source and image pins. | — |
| A02 | P0 CHECK | Reconcile contradictory architecture documents. | One approved contract retains personal agents and User/Agent/Team, defines server integration/routine authority and local-vs-cloud behavior, and identifies superseded docs. Resolve personal app ownership vs older Space-install wording. | A01 |
| A03 | P0 CHECK | Freeze the release capability matrix. | List every advertised action/provider/account type by platform and execution mode; identify implemented, missing, blocked and intentionally unavailable cells. No blanket claim that all integrations work. | A01, A02 |
| A04 | P1 CHECK | Assign owners, reviewers and release environment. | Actual owners cover host, Rust, API, runtime, SDK/apps, integrations, QA and release. Identify test accounts, disposable DB, Windows hardware/runner, Apple devices and production host. Record external blockers. | A03 |
| A05 | P1 CHECK | Resolve historical failures and document drift. | Re-run or supersede earlier focus-ring, Files, dependency-scan, website API-prefix and host-typecheck findings with current evidence. Link each surviving defect to a row. | A01 |

## B. Capability discovery, permissions and mode policy

Owner: backend + runtime + SDK. Section dependency: A02/A03. Gate: G1.

| ID | Priority / status | Work | Acceptance / required proof | Depends on |
| --- | --- | --- | --- | --- |
| B01 | P0 BUILD | Define a single enforcement matrix. | User reads/drafts and explicit profile/memory changes remain distinct from execution. Specify how server integration actions and enabled routines are authorized without depending on a local window lease. The model cannot activate a mode or expand assignments. | A02 |
| B02 | P0 PASS | Connect MCP/Activepieces tools to personal agents. | Replaced blanket exclusion in nativeAgentToolAllowed and nativeAgentInvocationPolicy with explicit MCP tool authorization and risk-based mode checks (RiskRead in User/Agent/Team; RiskWrite in Agent/Team). Wired executeMCPAgentTool to acquire per-user activepieces tokens and dispatch to mcpConnectorClient. CallTool. Verified via TestNativeAgentModesAndAssignmentsAreIndependentOfPlanning. | B01, F01 |
| B03 | P0 PASS | Connect registered SDK providers to personal agents. | Preserved SDK registrations in ai_invocation_agent_runtime.go for assigned apps instead of resetting to nil; updated nativeAgentInvocationPolicy to authorize assigned provider bindings. Verified via go test. | B01, I01 |
| B04 | P0 VERIFY | Recheck authority at every boundary. | API, MCP, SDK, queued worker, native browser, resume and completion paths enforce owner, Space membership, assignments, target, task/window and current revocation. Cross-account and cross-agent negative cases pass. | B02, B03 |
| B05 | P0 VERIFY | Validate tool schemas and catalog discovery. | Every advertised tool compiles against deployed model/runtime validators; pagination, duplicate names, empty/legacy schemas, stale fingerprints and limits fail clearly. A bad connector cannot silently erase unrelated capabilities. | B02, B03 |
| B06 | P0 PASS | Finish exact-action approval UX across paths. | Connected in-chat Action Approval Card in AgentConversationView and globalSearchStore to space_run approvals via agentsApi.decideApproval. SSE stream projects approval metadata; confirm and reject decisions dispatch to backend. Verified via globalMistyAgentResume.test.ts. | B04 |
| B07 | P0 VERIFY | Prove instruction and data boundaries. | Webpages, tool output, documents and connected data cannot grant permissions, change mode or exfiltrate unrelated context. Private execution data enters a Space only through explicit sharing. | B04 |
| B08 | P1 PASS | Make missing capabilities actionable. | Added system prompt instructions in ai_invocation_agent_runtime.go directing personal agents to name specific missing connections or modes and guide users to Agent Settings or Work Mode toggle instead of generic refusals. Verified via go test. | B02, B03, C06 |
| B09 | P1 CHECK | Reconcile delegation and agent coordination. | Preserve Team as local parallel windows. If existing delegation is exposed, implement bounded parent/child grants, budget, cancellation and result delivery; otherwise classify it as an explicit remaining path, not a shipped Team capability. | A03, B01 |

## C. Complete Agents interface

Owner: host/UI. Section dependency: A03. Gate: G2.

| ID | Priority / status | Work | Acceptance / required proof | Depends on |
| --- | --- | --- | --- | --- |
| C01 | P1 VERIFY | Audit every visible control and route. | Roster, search, new chat, suggestions/custom answer, composer, menus, details, history, Activity, settings, back/close and legacy deep links perform their stated action. Loading/empty/error/disabled states have recovery; no dead buttons or fake screen preview. | A01 |
| C02 | P1 PASS | Restore visible User / Agent / Team identity. | Added prominent in-chat mode selector pills above composer with tooltips and execution lifecycle control (calling finishLocalExecution on mode switch). Desktop-only gate preserves web/mobile safety. Vitest suite in AgentWorkspaceConversation.test.tsx passes. | B01 |
| C03 | P1 CHECK | Resolve mode persistence and agent switching. | Specify per-conversation/per-window preference versus session default; safe User default on a new account; changing agents/Spaces cannot silently inherit execution authority. Persistence never auto-starts work. | C02, D01 |
| C04 | P1 VERIFY | Finish profile/settings lifecycle. | Create, rename, avatar/expression, description, instructions, model, enable/disable, delete, assignments and optimistic conflicts persist atomically. Failed saves preserve drafts; unsaved edits are protected. | B04 |
| C05 | P1 VERIFY | Validate conversation and memory lifecycle. | New/history/search/reopen/rename/delete and retry bind to the correct agent/Space/account. Explicit remember/edit/forget persists; ordinary corrections do not become memory; attachment ownership survives reopening. | H02 |
| C06 | P1 BUILD | Add usable connection/account/assignment controls. | Users can distinguish connected accounts from apps assigned to an agent, see granted actions, choose the intended account, resolve missing access and revoke it. No internal tool IDs as primary labels. | F02, B02, B03 |
| C07 | P1 BUILD | Complete in-chat run states and recovery. | Queued, running, approval, login, device wait, timer wait, paused, partial, uncertain, failed, cancelled and completed states are truthful and have applicable controls; progress is sourced from actual run events. | H03, H04 |
| C08 | P1 VERIFY | Verify files, voice and attachments. | Actual microphone permission/record/transcribe/cancel, supported upload/preview/removal, size errors, send failure retention and download/open/export work. Voice transcription is not mislabeled as a full duplex voice agent. | E06, H02 |
| C09 | P1 VERIFY | Finish responsive/accessibility QA. | Desktop/window minimum sizes, split panes, light/dark, keyboard/focus, screen-reader labels, long names, large text and narrow mobile views pass; animated clouds honor reduced motion; no overflow or trapped focus. | C01–C08 |
| C10 | P1 VERIFY | Validate actual native shell integration. | Single-tab Agents chrome, multiple tabs/panes/windows, Windows caption controls and worker windows work in packaged native builds, not just the synthetic browser preview. | D04, L06 |

## D. User / Agent / Team execution

Owner: host + Rust + backend. Section dependency: B01. Gate: G1/G2.

| ID | Priority / status | Work | Acceptance / required proof | Depends on |
| --- | --- | --- | --- | --- |
| D01 | P0 VERIFY | User mode authority. | Assigned reads/drafts and allowed explicit management work; app writes and unauthorized reads are denied server-side, even with crafted API requests. A model request cannot switch mode. | B04 |
| D02 | P0 VERIFY | Same-window Agent mode. | Explicit activation acquires server/native leases, performs a real assigned-app action, shows the work surface and reports a verified outcome. Busy/pause/stop controls and human takeover behave correctly. | E01, B04 |
| D03 | P0 VERIFY | Destination/profile discovery. | Open and closed configured app accounts resolve to the original browser profiles; revoked/removed destinations disappear; no destinations produces useful guidance rather than pretending browser access exists. | E01 |
| D04 | P0 VERIFY | Team worker startup and isolation. | Two different agents run in real native windows; correct account/conversation/attachments arrive; navigation, webviews, files and cancellation stay isolated; main-window mode changes do not cancel independent workers. | D02, D03 |
| D05 | P0 VERIFY | Follow-ups, steering and queue order. | Corrections pause before interpretation and resume the right conversation with fresh authority; independent requests queue; explicit stop stays stopped; delayed classification cannot revive cancelled work. | D04 |
| D06 | P1 BUILD | Resolve process-local pending queue loss. | Persist admitted pending work with ownership/order/acknowledgements, or explicitly mark it interrupted on exit with a durable recovery action. Never silently lose an accepted queued request or auto-replay an uncertain effect. | H03 |
| D07 | P0 VERIFY | Lease expiry and device lifecycle. | Sleep, disconnect, renderer crash, worker close, app exit and lost heartbeats revoke dispatch. Resume requires fresh authority and rechecks accounts/assignments. Existing writes remain recorded. | D02, D04 |
| D08 | P1 VERIFY | Mode lifecycle across entry points. | Agents page, global Misty, selection/context-menu AI, SDK `misty.ai.open`, foreground queue and worker queue obey the same documented mode rules; web/mobile cannot invoke unavailable native modes. | A01, C02 |

## E. Browser, native actions and supported app catalog

Owner: Rust + host + apps/backend. Section dependency: B04. Gate: G2.

Every advertised action needs a successful real run, denied-target case, failure/recovery case and persisted/external result. Generic browser clicks do not certify a semantic provider such as Gmail.

| ID | Priority / status | Work | Acceptance / required proof | Depends on |
| --- | --- | --- | --- | --- |
| E01 | P0 BUILD | Finish the browser entry path. | “Open YouTube” in an explicitly authorized execution mode opens the correct browser surface, or offers the precise assignment/setup needed. General Browser navigation and provider-restricted sessions have distinct, enforced boundaries. | B01, A03 |
| E02 | P0 VERIFY | Inspect, navigate, click, fill, select, scroll and keys. | Native WKWebView and claimed WebView2 paths consume fresh document/element references; redirects, popups, stale targets, hidden fields and cancelled navigation cannot act on an unrelated page. | E01 |
| E03 | P0 VERIFY | Visual capture and pointing. | Capture corresponds to the authorized webview; coordinate normalization works with zoom, resizing and high DPI; stale images require reinspection. Denied/unsupported capture fails visibly. | E02 |
| E04 | P0 PASS | Complete login/intervention handoff. | AgentExecutionSurface locks/unlocks webview via browser_agent_set_locked, renders human takeover banner with "Paused — you can use this page" controls, and resumes autonomous execution via steerLocalExecution on confirmation. Verified via localExecution.test.ts. | H03, E02 |
| E05 | P0 VERIFY | Account and profile isolation. | Two accounts in the same provider retain correct cookies and targets; no silent credential/profile copying across agents, deployments, Spaces or users; removal/revocation invalidates queued access. | D03 |
| E06 | P0 VERIFY | Uploads, downloads and task artifacts. | File size/hash/type and conversation ownership checked; file selection is distinct from successful upload; downloads become ready only after actual completion; task files open/export under correct attribution. | E02, H02 |
| E07 | P1 CHECK | Define video-understanding support. | Clearly separate opening/playing a video, transcript retrieval and audio/video analysis. Implement and validate only the promised routes; no “watched” claim from a URL or unavailable transcript. | A03, E01 |
| E08 | P1 VERIFY | Chat, Journal, drawings and Library actions. | Assigned read/search/create/update/share/upload actions in A03 work with current permissions, version conflicts, private-vs-shared context and citations linking actual results. | B04, B06 |
| E09 | P1 VERIFY | Planner/calendar/roadmap actions. | Advertised query/create/update/delete actions handle timezone/DST, all-day events, assignees, stale edits and duplicates; unshipped roadmap or reminder capabilities are accurately gated. | B04, B06 |
| E10 | P0 BUILD | Finish Inbox/Social semantic adapters. | Claimed Gmail/Outlook and chosen Social providers pass real read/search/draft/approved-send, attachments, account selection and uncertain-send reconciliation. Distinguish accepted submission from delivered message. | E02, E04, E06, B06 |
| E11 | P0 BUILD | Complete Files mutation paths. | Local and supported remote browse/read/write/move/delete operations have correct path boundaries, stale-write protection, confirmation/recovery, bounded reads and failed-transfer reporting. | B04, B06 |
| E12 | P0 BUILD | Complete Code and Terminal action paths. | Exact patch/script/command approval, project/cwd/environment targeting, stale buffers, bounded output, process cancellation and persisted file verification pass; process exit alone cannot prove the user outcome. | B04, B06 |
| E13 | P1 VERIFY | Cross-app execution. | Planner + Notion, Instagram image draft/upload, and integration result → Journal/Library scenarios succeed with receipts and appropriate sharing/approval boundaries. | E06, E08–E12, F03 |

## F. Activepieces, MCP and integration onboarding

Owner: integrations + backend + host. Section dependency: A03. Gate: G1/G2.

| ID | Priority / status | Work | Acceptance / required proof | Depends on |
| --- | --- | --- | --- | --- |
| F01 | P0 VERIFY | Managed Activepieces access and isolation. | Per-user provisioning/access/token renewal works against the pinned deployed version; each user gets only their project/connections. Worker reaches app; app/DB/Redis health, encryption-key backup and restore are tested. | L01 |
| F02 | P1 BUILD | Complete account connection lifecycle. | Connect, choose account, consent, status, refresh, reauthorize, revoke and disconnect from Misty-owned controls; secrets never appear in model-visible data/logs. Clearly expose any necessary external setup. | F01 |
| F03 | P0 VERIFY | One-off agent integration action. | The selected personal agent discovers and executes a real permitted Activepieces action, gets exact-action approval when needed, and returns an independently verified result to its originating conversation. | B02, F02, H03 |
| F04 | P0 VERIFY | Integration failure and retry rules. | Rate limits, timeout, malformed schema, provider outage, expired token and uncertain mutation are distinct; stable effect identity prevents duplicates; unknown outcomes require reconciliation. | F03, H03 |
| F05 | P1 PASS | Finish flow authoring and management surfaces. | Native Flow canvas in AutomationEditor.tsx and listings in AutomationListings.tsx provide create, inspect, step-configure, test-step, run history, and enable/pause routes without third-party iframe embeds. Verified via AutomationsWorkspace.test.tsx. | F03, C01 |
| F06 | P0 PASS | Complete custom MCP connection path. | Enabled mcpConnections feature gate in publicBetaAvailability.ts; McpConnectionsSheet provides custom endpoint discovery, token management, and per-agent tool enablement. Verified via McpConnectionsSheet.test.tsx. | B02, B05 |
| F07 | P0 VERIFY | Scheduled provider flow while Mac is closed. | An enabled test flow runs once on the server, uses the correct account and produces durable run evidence/results visible when Misty reopens. No dependency on a native execution lease for server-only actions. | F03, F05, H05 |
| F08 | P1 CHECK | Freeze the supported provider catalog. | List exact integrations/actions/versions actually tested; verify credential prerequisites, quotas and applicable self-host/embed terms before promising a seamless embedded experience. | F02, F03 |
| F09 | P2 CHECK | Optional Zapier adapter. | If included, validate current MCP authentication/transport, user account mapping, tool grants, billing behavior and one real action with revocation. Otherwise record explicitly as optional, not unfinished Activepieces work. | F06, A03 |

## G. Saved routines and server background work

Owner: backend + runtime + host. Section dependency: B01/H03. Gate: G2.

Activepieces flows and Misty saved routines are distinct existing paths. Pick an authoritative scheduler for each routine type; do not let two systems execute the same occurrence.

| ID | Priority / status | Work | Acceptance / required proof | Depends on |
| --- | --- | --- | --- | --- |
| G01 | P0 CHECK | Reconcile routine authority and execution location. | Define native vs backend steps, connection/agent assignments, allowed mode, per-run approvals vs revocable standing grants, and scheduler ownership. Closing a laptop cannot be presented as compatible with local-only steps. | B01, F07 |
| G02 | P1 VERIFY | Immutable drafts and manual capability routines. | Save/list/read/version-conflict/manual-run/cancel routes pass against real DB and runtime; duplicate submission reuses the original run and changed inputs conflict. | I01, L02 |
| G03 | P0 VERIFY | Bounded agent steps. | Pinned action set, model/turn budgets, namespace, checkpoint/effect consistency, transcript continuation, partial/uncertain stopping and cancellation pass with deployed runtime protocol negotiation. | G02, H03 |
| G04 | P0 VERIFY | Durable timed waits. | App/worker restart during a wait preserves deadline and wait identity; early/stale wakes cannot advance steps; 24-hour expiry, cancellation, revocation and paused active-time accounting pass. | G02, H03 |
| G05 | P1 BUILD | Conversational routine setup and review. | Describe → draft → inspect accounts/actions/schedule → test → explicitly enable works from Agents; edits version the routine and cannot silently change active runs or grants. | G01–G04, C07 |
| G06 | P0 BUILD | Scheduler and product-event triggers. | Cron/timezone/DST, Planner/Journal events, durable occurrence identity, overlap policy, coalescing, outage catch-up and feedback suppression are implemented and tested. A saved schedule field alone is not an installed trigger. | G01, G05 |
| G07 | P0 BUILD | Native/browser routine steps. | If included in A03, dispatch only to the pinned available device/account, support safe login/interruption, and truthfully wait/fail while offline. Validate supported adapters; no fallback to a different host/provider. | E04, G02 |
| G08 | P1 BUILD | Routine operations and uncertainty recovery. | Enable/pause/edit/delete/test, next-run time, history, run detail, cancellation and uncertain-effect reconciliation are available; pausing blocks new occurrences while preserving history and existing effects. | G05, G06, C07 |
| G09 | P0 VERIFY | Background completion, cost and failure reporting. | Results reach originating conversation/Activity after app closure; budgets cap runaway work; interrupted/delegated usage reconciles once; failures are actionable without repeated notification noise. | G03, G04, G06, H05 |

## H. Sessions, runtime reliability and evidence

Owner: auth + backend + runtime + host. Gate: G1/G2.

| ID | Priority / status | Work | Acceptance / required proof | Depends on |
| --- | --- | --- | --- | --- |
| H01 | P0 PASS | Diagnose the reported greeting failure. | Traced stream failure to unhandled EOF flush without double newline in invocationStream.ts causing spurious interruption errors. Implemented terminal event flushing via processBuffer(final). Vitest suite (8/8 in invocationStream.test.ts) passes. | A01 |
| H02 | P0 VERIFY | Sign-in, refresh, account picker and logout. | Fresh/saved accounts, access-token expiry, 30-day refresh policy, rotation/races, app/API restart, offline recovery, revocation and account switching pass. Persisted signing keys survive restart; logout purges scoped data without affecting another account. | L01 |
| H03 | P0 VERIFY | Durable admission, effect journal and recovery. | Lost start acknowledgement, duplicate delivery, worker restart, timeout, partial result and uncertain mutation retain one run/effect identity. No duplicate external action or fabricated completion. Cancellation blocks new dispatch while preserving actual outcomes. | B04, L02 |
| H04 | P0 VERIFY | Approval, authentication and device waits. | Chat, quick AI, Space agent, SDK and routine entry points pause/resume through durable state; global intervention controls target the correct run; stale approval or login callbacks cannot revive revoked work. | B06, E04 |
| H05 | P1 VERIFY | Streaming, realtime and result reconciliation. | SSE reconnect/dedup/Last-Event-ID, separate Space WebSocket, app reopening and polling recover the same run. No forever-spinners, resubmitted model tasks, duplicate turns or cross-conversation updates. | H03 |
| H06 | P0 VERIFY | Model configuration and provider compatibility. | Available models/tool calling/context limits/attachments/timeouts work with deployed credentials; unsupported models fail clearly; fallback behavior is explicit and honors budgets. | B05 |
| H07 | P0 VERIFY | Quotas and cost accounting. | Account/Space/turn/run/tool budgets are enforced before effects; duplicate and late usage receipts reconcile once; interrupted/delegated work is accounted for; exhausted limits offer recovery. | H03, H06 |
| H08 | P1 BUILD | Actionable diagnostics and operations. | User gets safe failure reason, retry/resume action and reference ID; operators can correlate app/API/runtime/connector/device events. Alerts distinguish outage, authorization failure and stalled work without logging secrets. | H01, H03 |
| H09 | P1 VERIFY | Activity and notification lifecycle. | Running/blocked/completed/partial transitions, unread/request badges, filters, dismissal and deep links remain correct after reconnect/account switch. Real macOS/Windows notifications obey permission/mute rules; required requests remain recoverable. | C07, H05 |

## I. SDK, app installation and independent providers

Owner: SDK + apps + host/backend. Gate: G1/G2.

| ID | Priority / status | Work | Acceptance / required proof | Depends on |
| --- | --- | --- | --- | --- |
| I01 | P0 VERIFY | Synchronize contracts and generated surfaces. | Host/server/runtime/apps consume the same SDK/contracts archives; generated routes, schemas, capability versions and packed-consumer tests pass without private workspace imports. | A01 |
| I02 | P0 VERIFY | Installation trust and lifecycle. | Signed manifests, publisher trust, capability review, install/update/uninstall/reinstall, added permissions and rollback preserve version/generation checks. Removed apps cannot retain queued or old-token access. | I01, B04 |
| I03 | P0 VERIFY | Target-bound provider lifecycle. | Register/discover/availability/execute/result/cancel work through API and SDK with correct owner and target; unavailable/auth-required/stale providers cannot be silently replaced. | I02 |
| I04 | P1 VERIFY | Independent packaged provider proof. | Install the habit-tracker example using only public packages and normal trust controls; agent calls habits.list/record and writes an approved Journal summary. No sample-specific registry or harness exception. | B03, I03, E08 |
| I05 | P0 BUILD | Finish remaining host adapter bindings. | All browser/native/backend/view adapters included in A03 have target-bound invocation, validation, deadlines, cancellation, availability and result evidence. Unsupported ones reject before any effect. | I03, E02 |
| I06 | P1 VERIFY | Official app migration and compatibility. | Personal installs vs built-in Space tools match current ownership; old Agents mini-app/deep links reach the native page; catalog/package/minimum-host versions match actual shipped app set. Existing data and profiles survive update. | I02, A03 |

## J. Required end-to-end scenarios

Owner: QA with feature owner; reviewer independent of the implementation. Every row starts `VERIFY`; none is satisfied by mocks. Run with dedicated accounts on the release candidate after its dependencies pass. Capture failure and denied-access variants, not just the happy path.

| ID | Priority / status | Scenario and acceptance | Depends on |
| --- | --- | --- | --- |
| J01 | P0 VERIFY | Fresh account → sign in → create agent → assign app → User draft → explicit Agent activation → verified result → reopen history. Repeat saved-account sign-in after API/app restart. | C04, D01, D02, H02 |
| J02 | P0 VERIFY | “Open YouTube” → correct authorized native browser; inspect/navigate → stop. Missing assignment and wrong mode provide accurate guidance. | E01–E03, B08 |
| J03 | P0 VERIFY | Two configured accounts in one service → select intended target → draft → exact approval → one verified action. Deny approval, change recipient/input, revoke target mid-run. | B06, E05, E10 |
| J04 | P0 VERIFY | Two Team agents execute in parallel; steer one and stop the other; close/reopen a worker; main-window state and result attribution remain correct. | D04–D07 |
| J05 | P0 VERIFY | Real attachment → browser file input → verified site result; real download → task receipt → open/export; test oversize, failed upload and cancelled download. | E06 |
| J06 | P0 VERIFY | Connected Activepieces action → result in agent conversation; same action under rate limit/token expiry/lost response does not duplicate effects. | F03, F04 |
| J07 | P0 VERIFY | Enabled server flow/routine executes while Misty is closed; reopening shows one result, account attribution, history and next run. Disable prevents the next occurrence. | F07, G06, G08, G09 |
| J08 | P0 VERIFY | Worker/API restart during tool effect, approval wait and timed wait; recover from journal/checkpoint and prove no false success or duplicated mutation. | G03, G04, H03, H04 |
| J09 | P0 VERIFY | Revoke Space membership, app assignment, integration, and device access during queued/executing work. No later unauthorized effect or private-context exposure. | B04, E05, I02 |
| J10 | P1 VERIFY | Independent habit provider → conversational read/write → Journal summary using packaged SDK; uninstall/reinstall invalidates old authority. | I04 |
| J11 | P1 VERIFY | Real cross-app Planner/Notion and chosen Inbox/Social workflows, plus Files/Code/Terminal tasks, with reviewed writes and verified artifacts. | E08–E13 |
| J12 | P1 VERIFY | Every entry point in A01: direct Agents, global Misty, selection/context menu, SDK open/invoke, activity deep link, legacy route and routine/manual launch reaches the correct run and recovery UI. | C01, D08, I03 |
| J13 | P1 VERIFY | Keyboard-only, screen-reader, narrow window, long content, offline, large text and reduced-motion pass on shipped devices, including native dialogs and worker windows. | C09, C10 |
| J14 | P0 VERIFY | Seven-day internal pilot with real accounts, scheduled runs, sleep/reconnect and at least one controlled restart. Zero unresolved unauthorized actions, duplicate consequential effects, false successes or lost accepted work. Record run totals and all failures. | J01–J13 |

## K. Platform and production operations

Owner: release/operations + native QA. Gate: G3.

| ID | Priority / status | Work | Acceptance / required proof | Depends on |
| --- | --- | --- | --- | --- |
| K01 | P0 VERIFY | Production data and key continuity. | Restore rehearsal covers Misty DB, Activepieces DB/queue/cache, encrypted credentials, library/artifacts and required signing/encryption keys; defined recovery procedure avoids duplicate scheduled effects. No key material in evidence. | L02, H03 |
| K02 | P0 VERIFY | Production runtime/connector operations. | TLS/origins, worker reachability, stable secrets, pinned worker retention, health/readiness, retries, timeouts, resource sizing, queue monitoring and graceful drains work under expected load. | F01, H08 |
| K03 | P1 VERIFY | Responsiveness and performance. | Agree measurable chat-start, first-response, search, tool-start and recovery targets; measure with real roster/history sizes, long runs and parallel Team work; no unbounded polling, memory growth or blocked composer. | J04, H05 |
| K04 | P1 VERIFY | macOS native release acceptance. | Apple Silicon and Intel packaged builds pass real login/profile reuse, webview capture/point/upload/download, permissions, sleep/restart and update flows. | J01–J13, L06 |
| K05 | P2 VERIFY | Windows release acceptance. | Full supported Windows build and installed WebView2 scenarios pass, including capture, uploads/downloads, window chrome, Team isolation and sleep/restart. Isolated cross-compilation is insufficient. | J01–J13 |
| K06 | P1 VERIFY | Web companion capability gating. | Server-capable actions work; local actions explain device requirements; direct URLs cannot bypass gates; account auth and approvals match desktop permissions. | A03, B04 |
| K07 | P2 VERIFY | iPhone/iPad acceptance and distribution. | Real supported devices pass safe areas, rotation, multitasking, VoiceOver/large text, generic notifications, webview lifecycle and truthful desktop handoff. Complete TestFlight/App Store-specific gates before publishing. | A03, K06 |
| K08 | P0 VERIFY | Incident containment. | Provider/model/admission/routine kill switches stop new work without deleting history or abandoning effect reconciliation; revoke a compromised connection and exercise the support runbook. | B04, G08, H08 |
| K09 | P1 CHECK | Public promises, privacy and support readiness. | Current policies, retention/export/deletion, integration permissions, supported platforms, usage/billing and support links match actual release behavior. Recheck old legal/billing audit findings rather than treating them as current facts. | A03, F08, H07 |

## L. Integration, deployment and publication

Owner: release lead with backend/runtime/SDK owners. Gate: G3/G4. All operations below remain unperformed by this ledger.

| ID | Priority / status | Work | Acceptance / required proof | Depends on |
| --- | --- | --- | --- | --- |
| L01 | P0 CHECK | Reconcile running development/staging deployment. | Record actual API/runtime/Activepieces images, flags and migration heads against source. Identify old API compatibility restrictions and the exact upgrade path. Healthy containers alone do not pass. | A01 |
| L02 | P0 VERIFY | Rehearse schema and deployment upgrade. | Fresh DB and upgrade from a representative restored DB pass all required contracts, including previously compile-only tests. Review destructive migrations separately; prove retention, backups, forward recovery and old/new worker compatibility before applying. | L01 |
| L03 | P0 BUILD | Freeze a coherent multi-repo candidate. | Commit/review intended changes without sweeping unrelated dirty files; pin exact host/server/runtime/SDK/apps versions and hashes. Update release/pins, app set, generated catalog, minimum-host rules and changelog together. | I01, I06, L02 |
| L04 | P0 VERIFY | Run candidate release checks. | Host type/lint/tests/build, Rust tests/build, Go route/DB contracts, runtime tests/build, SDK packed consumer and app/provider suites pass at exact pins; failures are fixed or explicitly scoped, never hidden. | L03 |
| L05 | P0 VERIFY | Stage feature-flag rollout. | Enable only proven paths in dependency order; test runtime negotiation before admission. Record values for SDK, MCP/UI, routine drafts/manual/agent/wait and relevant platform flags. Disabling preserves reads/cancel/reconciliation. | L04, B02, B03, G02–G04 |
| L06 | P0 PUBLISH | Produce signed candidate artifacts. | Draft installers and updater archives are signed/notarized as required; app ZIPs, SDK/contracts, catalog/feed, source manifest, checksums and native reports are immutable and matched. No unsigned fallback. | L03, L04 |
| L07 | P0 VERIFY | Packaged install and two-version update. | Clean Apple Silicon/Intel install, actual downloaded app smoke, prior-version upgrade with saved sessions/data, app permission upgrade, bad signature/hash and interrupted install all pass. Only then update release/validation.json. | L06, K04 |
| L08 | P0 CHECK | Select production channel and backend. | Current macOS beta targets the development API. Choose and validate the intended production/staged channel, stable API/TLS, OAuth callbacks, operational ownership and support boundaries; do not accidentally market a dev-backed build as production. | K02, K09 |
| L09 | P0 PUBLISH | Deploy the matched API/runtime/integration stack. | Approved migrations and compatible pinned workers deployed; old runs drain/recover; catalog digest matches candidate; new deployment passes signed-in smoke and rollback/forward-fix checks. Record exact deployment IDs. | L02, L05, L08, J14 |
| L10 | P1 PUBLISH | Publish immutable release assets. | Use the documented assets phase with exact prepared bytes; verify all referenced archives reachable with correct hashes; retain previous assets. Publish SDK packages only to intended channels with matched docs and versions. | L06, L07, L09 |
| L11 | P0 PUBLISH | Promote catalog and update feeds. | After packaged acceptance and deployed digest verification, publish the prepared feed/catalog; a clean client discovers/installs/updates correctly. Do not rebuild or reuse a published version for changed bytes. | L10 |
| L12 | P1 PUBLISH | Publish user/developer documentation. | Mode descriptions, local/cloud limits, supported integrations, account setup, approvals, routines, recovery, SDK onboarding and release notes match released functionality. Remove superseded claims and broken entry links. | A02, L11 |
| L13 | P0 VERIFY | Post-publication monitoring and closure. | Repeat representative real journeys on published bytes; monitor auth, run/tool failures, stalled queues and notifications; record owners and rollback trigger. Close ledger only after release review accepts all required evidence. | L11, L12 |

## Gate order and next work

| Gate | Required outcome | Exit condition |
| --- | --- | --- |
| G0: Scope and inventory | A01–A05, L01, production/channel decision drafted | Every existing path mapped, contradictions resolved, owners and test environments known. |
| G1: Connected execution | B, H, I foundations; D01–D03; F01–F04 | One native browser action, one personal-agent integration action and one registered-provider action work with correct grants and receipts. |
| G2: Complete experience | C–J applicable rows | Modes, Team, supported apps, integrations, routines, recovery and seven-day pilot pass live acceptance. |
| G3: Release candidate | K and L02–L08 | Exact candidate passes automated and real packaged/device checks; migration/restore/update rehearsals complete. |
| G4: Published and observed | L09–L13 | Matched stack and immutable artifacts published, feed verified, docs current, post-release smoke accepted. |

Start with **A01/A02 and L01**, then **H01/H02**, **B01–B03**, and **C02**. Prove **J02** (native browser), **J06** (Activepieces action) and **J04** (two Team windows) before expanding catalog or routine UX. Reuse those proven execution paths for routines; avoid a second disconnected implementation.

These gates describe exit criteria, not a ban on preparing later work: candidate pinning, draft builds and deployment rehearsals must begin early enough to supply real packaged artifacts for G2 scenarios and the pilot. Publishing remains behind G3 acceptance. Follow the row dependency graph when scheduling work.

The ledger is not complete if a required path is merely hidden, renamed, marked healthy, or backed by an unexecuted test. Any scope reduction must be explicit, recorded, and reflected in release claims.

## Source map

Repository cleanup on 2026-09-18 moved historical strategy/implementation reports, mockups, and UI review captures out of the working tree. Their original paths below remain historical provenance, not current links. The local recovery archive is `/Users/mtccool668/.codex/cleanup-archives/misty-20260918-124607/files/`; its sibling `manifest.json` records file hashes. Current code, this ledger, release runbooks, and SDK/server records remain in their original repositories.

Paths in sibling repositories are relative to the Misty repository root, not this document's directory. Code and live observations establish the baseline; historical plans are evidence to reconcile, not instructions overriding the current request.

- Host product: `PRODUCT.md`; UI: `src/features/agents/AgentsPage.tsx`, `components/AgentWorkspaceConversation.tsx`, `agentsWorkspace.css`.
- Mode execution: `src/features/misty/useMistyStore.ts`, `src/features/agents/localExecution.ts`, `AgentWorkerRoot.tsx`, `AgentExecutionSurface.tsx`, `integrationDestinations.ts`; native coordinator: `src-tauri/src/infra/agent_workspace.rs`.
- Native mode/policy enforcement: `../misty-server/internal/platform/httpapi/native_agent_policy.go`, `ai_invocation_agent_runtime.go`, `ai_invocation_toolbox.go`; leases: `../misty-server/internal/platform/postgres/native_agent_execution.go`.
- Integrations: `../misty-server/internal/platform/httpapi/activepieces_managed.go`, `mcp_oauth.go`, `mcp_agent_runtime.go`; deployment: `../misty-server/compose.dev.yml`; host `src/features/agents/mcp/` and `automations/`.
- Runtime/capabilities: `../misty-server/apps/agent-runtime/src/`, `internal/agenttools/`, `internal/capabilities/`; SDK: `./packages/sdk/src/capabilities.ts`, `routines.ts` and contracts.
- Implementation records: `docs/implementation/native-misty-agents.md`, `native-agents.md`, `agents-workspace-refresh.md`, `activity-attention-history.md`; `../misty-server/docs/automation-beta-implementation.md`, `routines-beta.md`, `sdk-provider-installation.md`.
- Historical scope conflicts: `docs/strategy/managed-misty-mcp.md`, `docs/strategy/activepieces-self-hosted-mvp.md`, `./docs/native-agents.md`.
- Flags: `src/features/launch/publicBetaAvailability.ts`; server `sdk_providers.go`, `sdk_invocation_runtime.go`, `routine_drafts.go`, `routine_runs.go`.
- Release: `release/pins.json`, `release/validation.json`, `docs/release/macos-beta.md`, `apple-app-store.md`, `official-apps.md`, `0.1.0-beta.1-verification.md`; historical broader audit: `docs/launch/public-beta-readiness-audit-2026-08-26.md`.

## Change and evidence log

| Date | Change | Evidence / limitation |
| --- | --- | --- |
| 2026-09-18 | Ledger created after repository inspection and discussion of UI, modes, integrations and background work. | No release rows marked PASS. No feature flags, accounts, infrastructure, migrations, publishing settings or external integrations changed by this planning task. |
| 2026-09-18 | Repository cleanup preserved this ledger; historical material moved to the recovery archive above. | Typecheck and desktop build pass. Standalone script suite: 49 pass, 2 fail. A05 remains open: `app-source-paths.test.ts` expects the retired Agents mini-app alias; `vite-app-entry.test.ts` expects eagerly optimized `mammoth`. Both failures also reproduced with all removed files restored, confirming they predate cleanup. Logs: `/tmp/misty-cleanup-script-tests-final.log` and `/tmp/misty-cleanup-preexisting-check.log`. The Rust-driven stdin helper `tauri-shell-plugins.test.ts` is not a standalone Node test. |
| 2026-09-18 | Passed B02, B03, C02, H01: Enabled personal agent MCP tools & assigned SDK providers, restored in-chat User/Agent/Team mode selector, and fixed SSE EOF stream parsing. | misty host commit `a27c0ab4`, misty-server commit `728e68d`. All 32 agent test files (103 tests) pass in host; go test `./internal/platform/httpapi -run 'TestNativeAgent|TestMCP'` passes in server. Typecheck passes cleanly. |
| 2026-09-18 | Passed B06, B08, E04, F05, F06: Connected exact-action in-chat approvals, made missing capabilities actionable, completed login takeover handoff, verified native automation authoring, and enabled custom MCP connections. | misty host commits `df600385`, `c5c45471`, misty-server commit `e0b70f9`. Tests: `globalMistyAgentResume.test.ts`, `McpConnectionsSheet.test.tsx`, `localExecution.test.ts`, `AutomationsWorkspace.test.tsx`. Typecheck zero errors. |

### Evidence: B02 (Connect MCP/Activepieces tools to personal agents)
- **ID / status / verified date**: B02 / PASS / 2026-09-18
- **Owner / independent reviewer**: Backend + Runtime / Pair Review
- **Host, server, runtime, SDK, apps revisions**: misty-server `728e68d`, misty `a27c0ab4`
- **Environment / platform / feature flags**: Local dev / macOS / headless Activepieces
- **Reproduction steps and expected result**: Verify `nativeAgentToolAllowed` permits `mcp.*` tools in appropriate modes (`RiskRead` in `user`/`agent`/`team`; `RiskWrite` in `agent`/`team`). Verify `nativeAgentInvocationPolicy` authorizes personal agent MCP tools via `authorizeMCPAgentTool`. Verify `ai_invocation_agent_runtime.go` registers MCP tools using `executeMCPAgentTool` routing through `mcpConnectorClient.CallTool` with per-user activepieces tokens.
- **Observed result**: Tools discovered and mapped; policy checks pass.
- **Automated command + result**: `go test -v ./internal/platform/httpapi -run 'TestNativeAgent|TestMCP'` -> PASS.

### Evidence: B03 (Connect registered SDK providers to personal agents)
- **ID / status / verified date**: B03 / PASS / 2026-09-18
- **Owner / independent reviewer**: Backend + SDK / Pair Review
- **Host, server, runtime, SDK, apps revisions**: misty-server `728e68d`, misty `a27c0ab4`
- **Environment / platform / feature flags**: Local dev / macOS
- **Reproduction steps and expected result**: Ensure `prepareAIInvocationRuntime` preserves SDK registrations when `ProviderBinding != nil` matches assigned apps, and `nativeAgentInvocationPolicy` allows provider bindings for assigned apps.
- **Observed result**: Registrations are preserved and permitted for assigned apps.
- **Automated command + result**: `go test -v ./internal/platform/httpapi -run 'TestNativeAgent'` -> PASS.

### Evidence: B06 (Finish exact-action approval UX across paths)
- **ID / status / verified date**: B06 / PASS / 2026-09-18
- **Owner / independent reviewer**: Host UI + Backend / Pair Review
- **Host, server, runtime, SDK, apps revisions**: misty `df600385`, misty-server `e0b70f9`
- **Environment / platform / feature flags**: macOS desktop / local dev
- **Reproduction steps and expected result**: Verify `AgentConversationView` and `globalSearchStore` render an Action Approval Card displaying proposal summary, risk badge, and active Approve/Deny buttons when `event.phase === "approval"`. Clicking Approve or Deny dispatches `agentsApi.decideApproval(runId, approvalId, decision)`.
- **Observed result**: Action cards render with structured details; approvals dispatch to server and unblock run.
- **Automated command + result**: `npx vitest run src/features/global-search/globalMistyAgentResume.test.ts` (2 tests) -> PASS.

### Evidence: B08 (Make missing capabilities actionable)
- **ID / status / verified date**: B08 / PASS / 2026-09-18
- **Owner / independent reviewer**: Backend Runtime / Pair Review
- **Host, server, runtime, SDK, apps revisions**: misty-server `e0b70f9`
- **Environment / platform / feature flags**: Local dev / macOS
- **Reproduction steps and expected result**: Personal agent system prompt directs model to provide concrete recovery steps (naming the specific missing integration or mode) rather than issuing generic "I am an AI assistant and cannot browse" refusals.
- **Observed result**: Prompt instructs model on actionable integration recovery.
- **Automated command + result**: `go test -v ./internal/platform/httpapi -run 'TestNativeAgent'` -> PASS.

### Evidence: C02 (Restore visible User / Agent / Team identity)
- **ID / status / verified date**: C02 / PASS / 2026-09-18
- **Owner / independent reviewer**: Host UI / Pair Review
- **Host, server, runtime, SDK, apps revisions**: misty `a27c0ab4`
- **Environment / platform / feature flags**: macOS desktop
- **Reproduction steps and expected result**: View `AgentWorkspaceConversation` on desktop. Mode bar displays `User`, `Agent`, `Team` radio pills with clear tooltips. Switching mode invokes `finishLocalExecution()` and updates `useMistyStore.executionMode`.
- **Observed result**: Visual pill buttons rendered right above composer; mode switches cleanly with session teardown.
- **Automated command + result**: `npx vitest run src/features/agents/components/AgentWorkspaceConversation.test.tsx` (5 tests) -> PASS.

### Evidence: E04 (Complete login/intervention handoff)
- **ID / status / verified date**: E04 / PASS / 2026-09-18
- **Owner / independent reviewer**: Native Host / Pair Review
- **Host, server, runtime, SDK, apps revisions**: misty `df600385`
- **Environment / platform / feature flags**: macOS desktop / Tauri webview
- **Reproduction steps and expected result**: During browser execution, when human intervention or login is required, `AgentExecutionSurface` unlocks webview controls via `browser_agent_set_locked`, presents a "Paused — you can use this page" banner with takeover controls, and resumes autonomous task execution via `steerLocalExecution` upon user confirmation.
- **Observed result**: Intervention pauses run, unlocks page, and resumes cleanly.
- **Automated command + result**: `npx vitest run src/features/agents/localExecution.test.ts` (9 tests) -> PASS.

### Evidence: F05 (Finish flow authoring and management surfaces)
- **ID / status / verified date**: F05 / PASS / 2026-09-18
- **Owner / independent reviewer**: Host UI / Pair Review
- **Host, server, runtime, SDK, apps revisions**: misty `df600385`
- **Environment / platform / feature flags**: macOS desktop
- **Reproduction steps and expected result**: Access `/agents?tab=automations` route. `AutomationsWorkspace`, `AutomationEditor`, and `AutomationListings` allow creating, editing, testing steps, inspecting runs, and pausing/enabling flows natively without any external Activepieces iframes.
- **Observed result**: Full automation canvas and listing functional with native Misty minimal dark aesthetic.
- **Automated command + result**: `npx vitest run src/features/agents/automations` (5 files, 10 tests) -> PASS.

### Evidence: F06 (Complete custom MCP connection path)
- **ID / status / verified date**: F06 / PASS / 2026-09-18
- **Owner / independent reviewer**: Host UI + Backend / Pair Review
- **Host, server, runtime, SDK, apps revisions**: misty `c5c45471`
- **Environment / platform / feature flags**: macOS desktop / `mcpConnections: true`
- **Reproduction steps and expected result**: Enabled `mcpConnections: true` in `publicBetaAvailability.ts`. Custom MCP server URLs and bearer tokens can be added, tested, discovered, and removed via `McpConnectionsSheet`.
- **Observed result**: Custom tool connection management surface is active and fully functional.
- **Automated command + result**: `npx vitest run src/features/agents/mcp/McpConnectionsSheet.test.tsx` (2 tests) -> PASS.

### Evidence: H01 (Diagnose the reported greeting failure)
- **ID / status / verified date**: H01 / PASS / 2026-09-18
- **Owner / independent reviewer**: Host Runtime / Pair Review
- **Host, server, runtime, SDK, apps revisions**: misty `a27c0ab4`
- **Environment / platform / feature flags**: macOS / web
- **Reproduction steps and expected result**: Streams ending at EOF without a trailing `\n\n` delimiter should parse their final buffered event and complete cleanly rather than throwing "Interrupted stream".
- **Observed result**: `processBuffer(final)` flushes trailing terminal events on stream EOF.
- **Automated command + result**: `npx vitest run src/features/ai-surface/invocationStream.test.ts` (8 tests) -> PASS.
