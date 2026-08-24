# AI-Native Workstream Orchestration Ledger

Coordinator source: `README.md` and numbered briefs `01` through `23`.

Last updated: 2026-08-23 (initial foundation wave)

Canonical coordinator-seed checkpoint: `9b883a51` on `codex/workstream-01-misty-companion`. This checkpoint captures the pre-existing working-tree implementation without changing `main`; workstream commits must remain distinguishable from it.

## Governing rules

- Each workstream runs in its own persistent Codex task and isolated worktree/branch.
- A numbered brief is the workstream's source of truth.
- Every implementation task must audit current code, publish a staged plan, implement the authorized scope, run proportional tests, verify its acceptance gate, and hand off changes and residual risks.
- No workstream may silently redefine the AI Surface contract, artifact protocol, context boundary, permission model, workspace routing, or Misty state machine.
- Implementation waves contain no more than four active workstream tasks.

## Foundation contract ownership

| Contract | Current owner | Gate |
| --- | --- | --- |
| AI Surface and context receipt | WS01 | Pending |
| Misty Off → Follow → Engaged → Acting → Follow state machine | WS01 | Pending |
| Native artifact/proposal and recovery protocol | WS01 | Pending |
| Action/permission boundaries | WS01, later enforced by WS22 | Pending |
| Workspace routing and pane-context boundary | WS03 after WS01 handoff | Audit in progress |

Until the WS01 gate passes, WS03 and WS22 are audit/plan-only.

## Workstream status

| WS | Brief | Explicit dependencies | State | Task / branch |
| --- | --- | --- | --- | --- |
| 01 | Misty companion and global control | None | Implementing foundation; persistent executor exhausted task credits, coordinator-led rescue active in same branch | `01a02ffa-13c9-7cf3-a102-2d01093381b3`; `codex/workstream-01-misty-companion` |
| 02 | Global Search and launcher | 01, 03 | Blocked | Not created |
| 03 | Multi-pane workspace | None; architecture gated by 01 | Audit/plan complete; waiting for WS01 authorization | `01a02ffa-13c9-7cf3-a102-2ce3edad2a8f`; isolated worktree |
| 04 | Spaces | 03, 22 | Blocked | Not created |
| 05 | Space Chat | 04, 01 | Blocked | Not created |
| 06 | Notes / Journal | 04, 01 | Blocked | Not created |
| 07 | Drawings | 04, 01 | Blocked | Not created |
| 08 | Planner: tasks | 04, 01 | Blocked | Not created |
| 09 | Agenda and Calendar | 08, 04 | Blocked | Not created |
| 10 | Goals, milestones, and roadmaps | 08, 04 | Blocked | Not created |
| 11 | Library | 04, 15 | Blocked | Not created |
| 12 | Photo and media editing | 11 | Blocked | Not created |
| 13 | Inbox | 01, 04 | Blocked | Not created |
| 14 | Browser | 01, 03 | Blocked | Not created |
| 15 | Files | 01, 03 | Blocked | Not created |
| 16 | Code | 01, 15, 17 | Blocked | Not created |
| 17 | Terminal | 01, 03 | Blocked | Not created |
| 18 | Transfers | 15 | Blocked | Not created |
| 19 | Agents page | 01, 04, 22 | Blocked | Not created |
| 20 | Extensions | 15, 19 | Blocked | Not created |
| 21 | Activity and attention | 04, 19 | Blocked | Not created |
| 22 | Members, connections, permissions, and Settings | 04, 01, 19 | Audit/plan complete; waiting for WS01/bootstrap authorization | `01a02ffa-13ca-7143-bb5c-08e090592c6a`; isolated worktree |
| 23 | Authentication, installation, updates, and deployment | None | Ready by explicit dependency; sequenced last by README | Not created |

## Architecture decisions and conflicts

### AD-001 — Foundation contract freeze (active)

WS01 is the only workstream authorized to establish or change the protected AI contracts during the foundation gate. WS03 and WS22 may identify requirements but must route proposed changes to the coordinator.

### AD-002 — 04/19/22 dependency cycle (open)

The briefs form a cycle: WS04 depends on WS22; WS19 depends on WS04 and WS22; WS22 depends on WS04 and WS19. Tentative staged resolution, subject to the WS22 audit and WS01 contract:

1. WS22 lands only the permission/policy contract required by Spaces and Agents.
2. WS04 implements against that contract.
3. WS19 implements against WS04 and the policy contract.
4. WS22 completes its integrated access dashboard, connection health, and exact enforcement checks.

No task may broaden this staging without coordinator review.

WS22 audit evidence supports the staged break: existing human Space permissions and account OAuth enforcement can seed a bootstrap effective-access contract, but the full dashboard is not truthful until WS04 can enumerate shared/connected Space context and WS19 can expose effective agent identity, scope, and consent policy.

### AD-003 — Typed artifacts versus legacy Global Search proposals (decided)

WS01 found two competing paths: the canonical AI Surface uses durable typed artifacts and decision/completion endpoints, while Global Search exposes an ephemeral action-proposal shape and calls a decision route that is not mounted. Decision: migrate Global Search action mode to `/ai/invocations` plus typed `AiArtifact`, use `/ai/artifacts/{id}/decision` and `/completion`, then retire the ephemeral proposal branch/client call. No compatibility bridge or third shape is permitted. WS02 and WS19 must consume this contract and route any proposed delta through the coordinator.

### AD-004 — Native agent-run dispatch from accepted artifacts (decided)

Canonical `agent_task` acceptance creates the existing durable `space_runs` record. Decision: extend `AttachSpacesRuntime` with a narrow `AIService` executor callback that asynchronously invokes the existing `SpacesService.executeCanonicalAgentRun`; do not move artifact application into Spaces or add a new queue/worker contract in WS01. Dispatch must be exactly once for newly created runnable runs, preserve existing awaiting-approval authority, detach safely from the completed HTTP request with a bounded lifetime, and terminalize unavailable-runtime, error, and panic paths. A durable worker/queue remains a future scaling/recovery ADR, not a partial implementation.

### AD-005 — Native Browser tray ownership across navigation (decided)

The exact-origin contract remains authoritative: Browser navigation must not transfer prior-origin artifact data, session identifiers, context, or controls into the newly loaded document. Persistent action controls must be app-owned and independently layered above or outside native Browser content, with commands routed through the trusted app bridge. A newly navigated document may project only its own companion state. Cross-pane and post-navigation lifecycle controls belong to the global app-owned tray; redacting and reinjecting prior-origin controls into the new document is not an accepted substitute.

### AD-006 — Global Ask fallback and context expansion (decided)

Global Ask must not catch arbitrary canonical conversation-turn failures and silently fall back to `/ai/complete` with a broader search-result set. WS01 removes the broad fallback and fails closed with a visible retry path while preserving the exact selected `safeContext`. Any future compatibility/capability path is owned by WS02 and must explicitly negotiate support while retaining canonical binding, receipts, permission checks, and the exact user-selected context; it requires coordinator review before implementation.

### AD-007 — One canonical Global Search invocation entry (decided)

Global Search Ask and action modes both use `/ai/invocations`. The client must not pre-create an unbound legacy Misty conversation or send a first scoped turn through a second binding path. The first canonical invocation creates and immutably binds the conversation from the frozen, user-reviewed context receipt. Global Search must snapshot the exact selected context before any asynchronous work and may not reread mutable search context for that turn. WS02 may improve presentation and launcher semantics, but may not reintroduce a legacy conversation-turn transport.

### AD-008 — Complete immutable conversation scope sets (decided)

A durable AI conversation is bound to the complete normalized set of Spaces in its first frozen context receipt, not an arbitrary first Space. That scope set is immutable and every bound Space must be revalidated for every continuation and transcript list/detail read. Losing access to any bound Space makes the entire blended conversation inaccessible; partial answer redaction is not considered safe. Changing the scope set starts a new conversation. Legacy single-Space rows are treated as singleton sets. WS22 may extend the same authority model to agents and provider connections, but may not weaken all-scope revalidation.

### AD-009 — Interrupted client-native effects are uncertain (decided)

If cancellation, account clearing, navigation, or process teardown races a client-native artifact apply and the adapter may have ignored the abort, the effect is not classified as failed or safely retryable. It enters a durable `uncertain`/needs-review presentation, with no automatic reapply and no Undo claim unless completion evidence proves an applied effect. Terminal journal reconciliation must retire reconnect descriptors deterministically. Downstream surface adapters must preserve this ambiguity rule rather than inventing surface-local retry behavior.

### AD-010 — Durable artifacts inherit invocation authority (decided)

Artifact ownership does not grant indefinite access to Space-derived payloads. Every durable artifact inherits the complete immutable authority scope set of its invocation/conversation, and all list/detail, decision, completion, recovery, apply, and dispatch paths revalidate every scope. Losing any bound Space denies or redacts the artifact payload and prevents consequential action; a non-sensitive audit/tombstone may remain. Legacy or ambiguous scope data fails closed. Client trays converge to a redacted access-revoked state rather than retaining titles, operations, sources, or other Space-derived details.

## Shared-file conflict ledger

| Area | Reserved owner / status | Known overlap |
| --- | --- | --- |
| `app/src/features/ai-surface/**` | WS01 until foundation gate | 02, 03, 05–22 may consume contracts only |
| `server/internal/platform/httpapi/ai_*` and Misty conversation/runtime paths | WS01 until foundation gate | 19 and 22 likely overlap later |
| `app/src/features/workspace/**` and desktop workspace layouts | WS03 after authorization | 02, 04, 14, 15, 17 consume routing APIs |
| Settings, grants, members, connections | WS22 after staged authorization | 04 and 19 dependency cycle |
| Planner/date/dependency schemas | WS08, then consumers WS09/10 | Sequence consumers after WS08 gate |
| Library version/rendition/provenance | WS11, then WS12 | Do not run 11 and 12 concurrently |
| Local execution bridge and Files handoffs | WS15 foundation for 16/18/20; WS17 for 16 | Centralize destructive-plan and exact-confirmation semantics |
| Agent run/activity state | WS19, then WS21 | Shared attribution, approval, and task-history trail |

## Wave ledger

| Wave | Tasks | Status |
| --- | --- | --- |
| Foundation A | 01 implement; 03 audit/plan; 22 audit/plan | Active |
| Foundation B | 03 implementation; 22 bootstrap permission/capability contract | Pending WS01 gate and audit review |
| Wave 2 | 02, 04 | Pending 03 and WS22 bootstrap |
| Wave 3 | 19, then resume 22 full integration/gate | Pending 04; closes the 04/19/22 cycle |
| Wave 4 | 05, 06, 07, 08 | Pending stable foundation |
| Wave 5 | 09, 10, 13, 21 | Pending 08 and 19 as applicable |
| Wave 6 | 14, 15, 17 | Pending 01 and 03 |
| Wave 7 | 11, 16, 18 | Pending 04, 15, and 17 as applicable |
| Wave 8 | 12, 20, 23 | Pending 11 and 19/15 as applicable; WS23 deliberately follows README sequencing |
| Final integration | Cross-workstream build, tests, native checks, migration/restart/recovery regression, acceptance-gate audit | Pending all 23 |

## Acceptance-gate register

Every workstream must provide evidence for:

- dependable non-AI behavior;
- visible, bounded, removable, permission-correct context;
- native artifacts or native proposals;
- preview, conflict checking, attribution, and recovery for consequential changes;
- keyboard and reduced-motion behavior where applicable;
- intentional failure, stale-state, cancellation, navigation, and restart handling.

A first coherent slice is not a completed workstream. Persistent tasks must be resumed until every `Build next` item and applicable production-bar condition has evidence or a genuine external-authorization blocker is escalated.

Current trust-foundation gaps recorded by WS22: local Settings controls that are not runtime-enforced; non-atomic permission reset; dormant role/group tables; incomplete first-class agent membership; non-transitive connection revocation; stored-but-unenforced retention days; missing session/device management; and incomplete Settings focus/reduced-motion accessibility. These remain acceptance blockers, not deferred polish.

Current workspace-foundation gaps recorded by WS03: global `lastUsedTabByGroup` and `closedTabs` can cross Space boundaries; a disappearing pane can visually re-home an in-flight run without changing its session ownership; typed cross-pane references, semantic routing intents, working-set persistence, agent locus, and durable provenance are missing. Baseline verification: 66 focused tests passed; typecheck has two unsupported `forceNew` uses and one `WorkspaceScopeKey`/`WorkspaceGroupKey` mismatch. These must be resolved or explicitly attributed before the WS03 gate.

WS01 remains on hold at the independent foundation gate until all of the following have deterministic test evidence: atomic/reconcilable artifact and answer/terminal journaling; a single terminal result for cancel-versus-apply races; immutable conversation identity and complete Space-scope validation across continuations, mode changes, and transcript reads; canonical `/ai/invocations` use for every Global Search turn with frozen selected context; recursive context sanitization; terminal Agent-link failure; persistent app-owned action controls over native Browser webviews after origin/navigation changes, including over-cap ordering and IPC fallback; cooldown behavior when browser storage is unavailable; and global AI Off enforcement across presence, recovery, navbar, and shortcut entry points.
