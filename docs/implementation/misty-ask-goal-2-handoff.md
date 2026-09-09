# Misty Ask — Goal 2 handoff

**Gate: passed. Stop here. Goal 3 has not started.**

Goal 2 connects semantic capabilities to browser execution through the existing global Ask runtime. The four repositories contain uncommitted Goal 1, Goal 2, and pre-existing development work; these are combined working-tree checks, not a released build.

## Delivered behavior

- A versioned browser route declares an adapter and adapter version. The shipped registry supplies Gmail and Outlook email actions and Todoist task creation. Undeclared, unknown, or unsupported adapters remain unavailable. Existing backend adapters remain available through the same dispatch boundary; browser requests do not fall back to an API.
- `inbox.read`, `inbox.draft`, and `inbox.send` operate on an identified message/thread. Draft and send verification preserves the observed account, recipients, body and content hash. `tasks.create` accepts title, text, resolved destination, optional due date, and source reference; it returns an identified task, destination, actual content, and evidence.
- Planner is a trusted installed resource provider. An unqualified task request defaults visibly to the originating Space’s Planner. Missing Space context, ambiguous external accounts/projects, and inaccessible destinations require resolution. Explicit external requests do not silently choose Planner. The request’s pinned Space is preserved.
- Browser targets bind device, profile, view scope, intended account, and allowed origins. The shared executor inspects live page state before preparation and commit. Host-owned provider extractors read account chrome and message/task identity; absent or ambiguous identity requires intervention. Page text remains untrusted data.
- Preparation uses existing inspection, click, type, interaction, and navigation jobs. Device leases, grants, cancellation, execution budgets, intervention waits, protected approvals, and durable effect journals are reused. There is no second model or agent loop.
- Consequential review contains the actual prepared content and destination. A changed account, recipient, body, draft, or task destination invalidates approval. Native browser actions reject stale snapshots before dispatch and consume click snapshots to prevent reuse.
- Lost commit responses trigger inspection and verification, never another write. Unconfirmed effects remain uncertain and block dependent work. Draft preparation is journaled too; replay does not open a second draft. Planner uses a stable effect-derived task identity and verifies stored content.
- Ask’s catalog replaces legacy destination-specific tools when semantic providers are available. Trusted capability metadata lets the runtime recognize verified completion by any provider. The fixture provider requires no Ask-loop modification.

## Main implementation locations

Paths below are relative to the sibling repositories under `misty-org`.

| Layer | Location |
|---|---|
| Public browser/task/mail contracts | `misty-sdk/packages/contracts/src/{capabilities,task-capabilities,communications-capabilities}.ts` |
| Shared browser executor and pilot adapters | `misty-server/internal/browseractions/` |
| Existing invocation integration and Planner executor | `misty-server/internal/platform/httpapi/sdk_*execution.go`, `agent_sdk_capabilities.go`, `sdk_invocation_runtime.go` |
| Target resolution, pinning, and Planner authority | `misty-server/internal/platform/postgres/sdk_targets.go`, `sdk_planner.go`, `agent_sdk_capabilities.go` |
| Trusted page observations and stale-action checks | `misty/src-tauri/src/infra/browser_semantic_snapshot.js` and existing browser snapshot/action scripts |
| Leased native operation error classification | `misty-apps/apps/agents/workspace/worker.ts` |
| Provider-independent completion checks | `misty-server/apps/agent-runtime/src/` |

Forward migration `20270131000000_sdk_builtin_planner.sql` adds the installed Planner provider path and constrained resource targets. The disposable pilot baseline now applies all **195 migrations**, retaining Goal 1 and the previously introduced routine dependencies. Routine features remain gated; no routine development was added.

## Gate verification

| Check | Result |
|---|---|
| Backend internal package regression | Passed |
| Full PostgreSQL, HTTP API, and HTTP application contract suites | Passed: 127.390s, 73.824s, and 0.684s respectively |
| Real admission/MCP/approval/effect/device-job integration | Passed: all 21 scenarios |
| SDK build, typecheck, and tests | Passed: 30 files, 95 tests |
| Packed SDK and independent consumer check | Passed; host and official-app archives synchronized |
| Host and official-app source typecheck | Passed |
| Focused host regression | Passed: 9 files, 55 tests |
| Agent runtime typecheck and regression | Passed: 23 files, 100 tests |
| Native macOS library compile | Passed; existing Cocoa deprecation warning remains |
| Generated server contracts match the public SDK | Passed |
| Whitespace/conflict checks across four repositories | Passed |

The 21 API scenarios cover Gmail, Outlook, Todoist, Planner, global Ask dispatch, autonomous email read/draft preparation, login intervention/replay, stale-page recovery, changed account/recipients/content/destination, cancellation, disconnected device, lost response, and uncertain effects. Executor tests additionally cover a fixture mail provider, profile/scope/origin changes, exact verification, and durable prepared-content hash stability. Database tests cover explicit destination ambiguity, Planner permissions, revocation, and originating Space pinning. Runtime tests cover semantic completion across Planner, Todoist, and a fixture provider and reject uncertain or unrelated results.

The final regression exposed a budget/replay issue: fresh browser-preparation budget checks ran before saved results could replay. The check now runs inside the journal’s fresh-preparation callback. Existing backend replay tests ensure exhausted runs can retrieve confirmed results while new effects remain blocked.

Reproduce the full backend gate from `misty-server`:

```sh
./scripts/test-automation-beta.sh
```

This script creates and removes a disposable `pgvector/pgvector:pg16` database; it does not migrate a developer or pilot database. Test logs for this run are in `/tmp/misty-goal2-*.log` and are temporary.

## Tested development versions

These base commits identify the uncommitted working trees, not the complete delivered changes:

| Repository | Base commit |
|---|---|
| `misty` | `61067103792309f8f30d4011dcddd08fd24aecbc` |
| `misty-apps` | `7f4a0ca91d06abdbec5b1b3ddea15062500a18b3` |
| `misty-sdk` | `ad375b78cc6619f4667f5ba19e273547958b08fb` |
| `misty-server` | `173fc6666350eaba3b530e5cbd72030558847729` |

- Contracts archive: `misty-contracts-0.1.0-37149bfe5011183f.tgz`; SHA-256 `37149bfe5011183f794e34eab4304618b6e22a01affe3d6ea3f42c1a910fa31c`.
- SDK archive: `misty-sdk-0.1.0-b66d8dda8b2add39.tgz`; SHA-256 `b66d8dda8b2add399732ca1c7381d0e2dfe792efe0b0e542a200cf0ff204f038`.
- Planner migration SHA-256: `aaf3d528c4421f2cb9582f1e5a752369437c203a6c1bba5b4e28386ecf96a319`.
- Both packages retain development version `0.1.0`; consumers use immutable content-addressed archives. Server schemas were regenerated and checked against the same contracts.

## Handoff boundary and deferred work

**This is fixture-backed execution readiness, not live provider certification.** The integration tests use the real server, database, runtime transport, approvals, journals, and leased jobs with simulated signed-in website observations. Conservative Gmail, Outlook, and Todoist DOM mappings still need validation and any necessary selector/guidance adjustments against real pilot sessions. A changed or unrecognized page fails closed rather than claiming a completed action.

Goal 3 owns the native context menu, trusted gesture/context snapshots, full Ask progress/result-link experience, all four mail/task combinations twice against real websites, interruption cases, and the recorded macOS demonstration. It requires controlled signed-in accounts and a reachable pilot backend/runtime. No live messages were sent, external tasks created, pilot migrations applied, or services deployed for Goal 2.

Unresolved browser writes remain blocked for reconciliation; this milestone does not add an operator reconciliation UI or automatically retry uncertain writes. Additional provider certification, attachments, arbitrary website automation, recurring schedules, standing send permissions, mobile work, and production rollout remain excluded.
