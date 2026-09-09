# Misty Ask — Goal 1 handoff

**Gate: passed. Stop here. Goals 2 and 3 have not started.**

Implemented the global Ask ownership model across the host, official apps, public SDK contracts, Go backend, and runtime consumers. The working directories also contain pre-existing development work; this handoff describes the Goal 1 changes and the combined working tree that was tested.

## Result

- Global Misty Ask owns conversations and execution. Removed custom-agent configuration, Space membership and selection, the agent mention picker, assignment-based dispatch, per-agent history endpoints, Space-agent workflow triggers, group action-suggestion workers, associated UI, caches, and obsolete contracts/tests.
- Ask identity, version snapshots, MCP bindings, conversations, and conversation events use dedicated `misty_ask_*` tables. Conversation storage no longer has a `personal_agent_id` ownership field.
- Kept model calls, device jobs, runtime scheduling, owner-scoped cancellation/retry, exact-effect approvals, budgets, and durable effect tracking. Existing shared execution routes and some internal runner names still contain “agent”; they operate on global Ask and do not expose a custom/Space-agent product.
- Requests capture their originating conversation and Space before asynchronous preparation. Changing the active view does not retarget work. Explicit accessible Space requests are resolved; mixed, ambiguous, unavailable, and missing contexts do not select an arbitrary Space.
- Replaced the Space permission `agents.run` with `ask.run`, preserving overrides and role grants. Removed `agents.manage`.
- Removed retired SDK operations and agent task-assignment inputs as a coordinated development update. Host, official apps, and server consumers use synchronized contracts.

## Data migration and pilot baseline

Forward migration: `misty-server/internal/platform/postgres/migrations/20270130000000_global_ask_identity.sql`.

The migration classifies identities, conversations, runs, and invocations before deleting anything. System-managed Ask identities and unbound global Ask conversations survive, including historical companion-mode Ask records. Custom/Space-agent histories, delivery records, effects, private agent membership, and configuration/trigger tables are removed. Ordinary tasks, connected accounts, private conversation containers and their human audience survive. Existing applied migrations remain intact. The Down migration refuses rollback because deleted histories cannot be reconstructed.

Retired uploaded avatar objects are added to the existing durable object-deletion queue, excluding objects referenced by users or surviving Ask identities/versions. Physical removal against live object storage was not exercised by this database gate.

The disposable baseline applies **all 194 migrations**, including the routine migrations already introduced by the other task, using `pgvector/pgvector:pg16`. It creates an ordinary `misty_app` role and removes the disposable container after testing. Routine features remain behind their existing flags (`MISTY_ROUTINES_ENABLED`, `MISTY_ROUTINE_DRAFTS_ENABLED`, `MISTY_ROUTINE_AGENTS_ENABLED`, and `MISTY_ROUTINE_WAITS_ENABLED`).

## Verification

| Check | Result |
|---|---|
| Entire backend PostgreSQL contract suite | Passed, 106.793 seconds |
| Entire backend HTTP API contract suite | Passed, 44.129 seconds |
| Entire backend HTTP application contract suite | Passed, 1.129 seconds |
| Selective migration, routine baseline, session/Space binding and RLS checks | Passed against the final migration |
| Retired route inventory and mixed-context admission checks | Passed |
| Frontend regression | 21 files, 91 tests passed |
| Final originating-conversation/Space checks | 3 files, 20 tests passed |
| Host and official-app source typecheck | Passed |
| Backend internal package regression | Passed |
| Agent runtime typecheck and regression | Passed; 22 files, 95 tests |
| SDK build/typecheck/regression | Passed; 28 files, 90 tests |
| Additional SDK retirement contract checks | 2 tests passed |
| Packed SDK in an isolated independent consumer | Passed |
| Server contract snapshot matches public package | Passed |

The migration fixture includes both retained Ask and retired agents, conversations, queued work, approvals, invocations, non-cascading delivery/effect history, connected accounts, private task audience, and an uploaded-avatar cleanup record. It verifies Ask operation after migration and rejects dispatch through the retired identity.

The regression initially exposed three stale fixtures. The browser fixture now uses the canonical capability definition; target settings use host authority; intervention targets are admitted before execution. The final complete backend regression passes.

Reproduce the disposable backend gate from `misty-server`:

```sh
./scripts/test-automation-beta.sh
```

Reproduce the public package synchronization from `misty`:

```sh
npm run sdk:sync
npm --prefix ../misty-server run contracts:sync
```

## Tested development versions

Node `v26.3.1`; Go `go1.26.2 darwin/arm64`; PostgreSQL image `pgvector/pgvector:pg16`, image SHA-256 `405e59721305d49a4e570e38ec1fa7f3b2151efcc71c19a2009501dd975a39c7`.

These are the base commits of the tested, uncommitted working trees:

| Repository | Base commit |
|---|---|
| `misty` | `61067103792309f8f30d4011dcddd08fd24aecbc` |
| `misty-apps` | `7f4a0ca91d06abdbec5b1b3ddea15062500a18b3` |
| `misty-sdk` | `ad375b78cc6619f4667f5ba19e273547958b08fb` |
| `misty-server` | `173fc6666350eaba3b530e5cbd72030558847729` |

- `@misty/contracts@0.1.0`: `misty-contracts-0.1.0-9d3d6ec22b0e17bd.tgz`; SHA-256 `9d3d6ec22b0e17bdc3ed64804691eee36286151c1d988e6568dd51b18994f668`.
- `@misty/sdk@0.1.0`: `misty-sdk-0.1.0-96f9b863840bd0f4.tgz`; SHA-256 `96f9b863840bd0f4f1e3180e4a6ce628be20d87fb71e1815c961be1651410823`.

Migration SHA-256: `46e0a337544791e459cc667f7f1a4ddf8a0b39d39695ac046e66b9dff54f3bc8`.

## Handoff boundary and deferred work

Next is a separately authorized Goal 2: interchangeable browser-provider execution through the existing invocation system. Browser adapters, `tasks.create` semantics across Planner/Todoist, verified account binding, and website commit reconciliation are not delivered by this gate.

Goal 3 owns the native context menu and live Gmail/Outlook × Planner/Todoist acceptance matrix. Signed-in pilot accounts, login intervention, reachable backend/runtime, real sending, and a recorded macOS demonstration remain prerequisites for that gate. A general production rollout and additional routine development remain excluded.
