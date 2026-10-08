# Sync batching — implementation plan

Written October 9, 2026 against `main` at `3fbe6f820`. Goal: fewer sync requests per device, and therefore less server load, without losing edits or making multi-machine editing feel slow.

## Status (October 9, 2026)

Phases 1–4 are implemented and uncommitted. Passing: the browser-sync crate (137 tests, 14 new), `cargo check` of the desktop host, the browser-workspace and settings vitest suites, and `internal/sync` against a disposable Postgres (30 tests), including `TestBrowserSyncNativeWorkspacesAgainstGo` (two real Rust workers against the Go server, three runs) and the new `TestBrowserSyncBatchingPolicyFollowsTheAccountAndOnlyReachesBatchingClients`. The native fixture had gone stale before this work (single-writer assertions, bookmarks in the shared workspace, the old `native_tree_fixture_ok` marker) and was updated to the multi-writer model. `TestBrowserSyncDevicesAdvertiseKnownControlVersionsOnly` fails on `main` too: it still expects control version 3 to be rejected. Where the build differs from the plan below:

- **Code.** Client: `src-tauri/crates/browser-sync/src/batch.rs` (policy, clamping, `Batcher`), `workspace/fold.rs` (queue folding), gates in `WorkspaceSync::tick` and `records_tick`, `Collection::queue`, `WorkerHandle::flush`. Host: `browser_sync_flush`, a bounded flush in `stop` (1 s) and on app exit (2 s). Server: `server/internal/sync/batch_policy.go`, `rate_limit.go`. Settings: `sync.frequency` in both definition files and the Overview row.
- **Every lane has a `max_edits`.** Slots 100, contended 50 (the table below had none).
- **Gated by a connection parameter.** The client connects with `batching=1`; only then does the server send `batch_policy` or answer `sync_rate_limited`. Older clients reject unknown frames and treat any unknown error as a bad edit, so they are neither sent the frame nor rate limited.
- **Revision.** `MISTY_SYNC_BATCH_REVISION << 32 | account settings revision`, so both an operator change and the person's own change outrank what a client holds.
- **Server config.** `MISTY_SYNC_BATCH_LANES` (JSON object of lanes, same shape as the frame) overlays the defaults; `MISTY_SYNC_BATCH_REVISION` must grow whenever it changes. An invalid value logs and falls back to the defaults.
- **Rate limit.** A per-process token bucket per device: bursts of 60 publishes, refilling one per second. It counts workspace ops and collection pushes.
- **Flush on switching.** `WorkerHandle::open_workspace` and `claim_workspace` flush first, since the workspace being left stops being watched and its queue would otherwise wait for the next visit.
- **Sync now** appears as the status action while the connection is ready and a workspace has unsent edits.

## Current state

| Concern | Today | Problem |
|---|---|---|
| Coalescing | Already done by construction. `WorkspaceSync::tick` rebases every queued edit onto the last confirmed server state, and `WorkspaceState::build_op` ([state.rs:291](../../src-tauri/crates/browser-sync/src/workspace/state.rs#L291)) diffs the result against that state. Tab 1 open → tab 2 close → tab 1 close publishes only tab 2's delete. Collections keep pending writes per record key; page slots are last write wins within one op. | None for correctness. Two gaps listed under phase 3. |
| When ops go out | The worker ticks every 250 ms ([worker.rs:1188](../../src-tauri/crates/browser-sync/src/worker.rs#L1188)) and publishes as soon as anything is queued and nothing is in flight for that workspace. `records_tick` does the same for collections. | Edits only merge while an op is in flight, so active browsing sends about one op per round trip per device, and the server fans each op out to every other machine on the workspace. |
| Renderer debounce | `BrowserSyncController` captures after 400 ms quiet, 2 s cap ([BrowserSyncBridge.tsx:159](../../src/features/browser-workspace/BrowserSyncBridge.tsx#L159)). | Local IPC into the durable queue only. It does not pace the network and stays as is. |
| Durability | Edits land in the encrypted desired store (`Store::set_workspace_desired`) before anything is sent. | Nothing to fix: holding an op longer cannot lose an edit, and a restart publishes on connect. |
| Rejections | `WorkspaceSync::on_error` treats every unknown error code on an in-flight op as structural and drops its oldest edit ([sync.rs:724](../../src-tauri/crates/browser-sync/src/workspace/sync.rs#L724)). | A server rate-limit reply would silently discard edits. Phase 4 must handle it first. |

Out of scope: the pre-workspace mutation log (`Store::pending(true, 1)` in `Worker::connected`). It only runs before a vault switches to workspace mode and already sends one mutation at a time.

Not in Kiri. Kiri is the page-facing platform layer and has no access to vaults, workspace state or the desired store. The scheduler lives in `misty-browser-sync` beside `tick` and `records_tick`.

## Model

A **lane** is one stream of outgoing changes with its own timing:

| Lane | What it carries | quiet | max_wait | max_edits |
|---|---|---|---|---|
| `workspace` | window, tab, view records (plus any slots queued with them) | 1 s | 5 s | 50 |
| `slots` | page history, page state, page storage and sign-in shards when no record edit is queued | 3 s | 15 s | 100 |
| `collections` | bookmarks, saved tab groups, passwords, extension sync | 1 s | 5 s | 50 |
| `history` | history batches | 10 s | 60 s | 200 |
| `contended` | overrides `workspace` and `slots` while another machine is editing the same workspace | 250 ms | 1 s | 50 |

A lane is due when any of these holds:

- **quiet**: no new edit for `quiet` (the burst ended).
- **max_wait**: the oldest unsent edit is older than `max_wait` (continuous activity still syncs).
- **max_edits**: that many raw edits are queued (a safety valve; the op itself stays bounded by the existing 256-change and `OP_SLOT_BUDGET` limits).
- **urgent**: the worker was asked to flush (see phase 2).

Nothing about what is sent changes; only when. A due lane publishes exactly what `tick` publishes today.

**Contended** is detected locally: a `WorkspaceDelta` from another device for a workspace this machine is writing marks it contended for 30 s. No protocol change, and it covers the case where batching would otherwise grow compare-and-swap rebases.

## Policy source (options 1 + 2)

**Server policy.** The server owns the timings. It sends a `batch_policy` frame right after `welcome` and again whenever the account's preset or the server's base policy changes:

```json
{ "type": "batch_policy", "revision": 3, "preset": "balanced",
  "lanes": { "workspace": { "quiet_ms": 1000, "max_wait_ms": 5000, "max_edits": 50 }, "...": {} } }
```

The server resolves the preset before sending, so the client applies `lanes` as given. Base values come from server config (env or a config file on the VPS), so load can be tuned for every client without a release.

**Client bounds.** Server-sent settings are untrusted on desktop (see the synced-settings trust rule). The client clamps every value: `quiet_ms` 100–60 000, `max_wait_ms` 250–300 000 and at least `quiet_ms`, `max_edits` 1–1 000. A missing or invalid frame falls back to the compiled defaults in the table above. Urgent flushes ignore policy entirely.

**Account preset.** One account setting, `sync_frequency`, enum `live | balanced | saver`, default `balanced`, owner `account`, platform `desktop`, in [settings_definitions.json](../../server/internal/platform/transport/settings_definitions.json). The server multiplies the base policy:

| Preset | quiet | max_wait | max_edits |
|---|---|---|---|
| Live | ×0.25 | ×0.2 | ×0.5 |
| Balanced | ×1 | ×1 | ×1 |
| Saver | ×4 | ×6 | ×2 |

`contended` is never multiplied; two machines editing together always stay near-live.

**Settings UI.** One row in the Overview section of [BrowserSyncSettings.tsx](../../src/features/browser-workspace/BrowserSyncSettings.tsx), below the status: label "Sync frequency", segmented control Live / Balanced / Saver, Reset only while it differs from Balanced, no helper text. Writing it goes through the existing account settings path; the server then pushes a new `batch_policy` frame on every open sync connection for the account.

## Phases

### Phase 1 — client batcher with compiled defaults

- New `src-tauri/crates/browser-sync/src/worker/batch.rs`: `Lane`, `LanePolicy { quiet, max_wait, max_edits }`, `BatchPolicy` (all lanes + `Default`), and `Batcher` holding per lane and per target the first and latest edit `Instant`, the raw edit count, and the contended deadline. `Batcher::due(lane, target, now) -> bool`, `Batcher::edited(...)`, `Batcher::published(...)`.
- Mark edits where they enter: `WorkspaceSync::apply_changes` (workspace or collections by `belongs_to_shared`), `write_slot` (slots), collection writes in `worker/collections.rs` (collections or history by collection name).
- Gate publication: `WorkspaceSync::tick` skips a writable workspace whose lane is not due. `records_tick` skips pushes (not pulls) for a collection that is not due. The 250 ms interval stays as the scheduler resolution.
- Restart: edits found in the desired store at startup count as queued at connect time, so they go out after `quiet` rather than immediately in a burst.
- Contended: `on_delta` from another device for a workspace in `publish_targets()` sets the deadline.
- Stats: add `OPS_DEFERRED` and `EDITS_COALESCED` (raw edits carried minus ops built) to `workspace/stats.rs`.

Tests (crate): the issue's example (open, close, close within one window → one op with one delete); a burst of 200 edits over 4 s → one op; continuous edits every 500 ms for 12 s → ops at about 5 s intervals; `max_edits` triggers early; a delta from another device switches to contended timing and expires; edits queued before a restart publish after `quiet`.

### Phase 2 — urgent flush

- `Command::Flush { reply }` and `WorkerHandle::flush()`: marks every lane due, runs one tick, and replies once nothing is in flight or after 5 s.
- Callers in the host (`src-tauri/src/infra/browser_sync.rs` and `browser_sync/handoff.rs`): app quit and window close-all, vault lock, sign-out and account switch (before awaiting worker shutdown), `open_workspace` / `claim_workspace` (flush the current workspace first), sign-in lease handoff, and a "Sync now" action from the status view's existing retry button when queued edits exist.
- The renderer's `flushLocal()` on stop already empties the journal into native; the host flush follows it.

Tests: quit with edits queued inside the quiet window publishes them before shutdown completes; lock flushes before keys are dropped.

### Phase 3 — coalescing gaps

- **Fold queued batches.** While an op waits longer, `desired.batches()` grows and every tick and `optimistic_view` replays all of them. Fold consecutive batches made against the same base version: create + patch → create with merged fields, create + delete → nothing, patch + patch → merged patch, patch + delete → delete. Batches made against different versions stay separate, because that separation is what stops a stale edit from recreating a record another machine deleted (`model::rebase_batches`). Run the fold in `apply_changes` after `push_batch`.
- **Never-confirmed collection records.** `CollectionState::write(key, None)` for a key with no confirmed version removes the pending entry instead of queuing a delete against version 0.

Tests: a folded queue rebases to exactly the same records as the unfolded queue, across a randomized sequence including remote deletes between batches; create-then-delete of an unconfirmed bookmark sends nothing.

### Phase 4 — server policy, preset and enforcement

Server (`server/internal/sync`):
- `BatchPolicy` config with the compiled defaults, loaded once at start; preset multipliers; `sync_frequency` read from the account's settings.
- Send `batch_policy` after `welcome` in [http_connection.go](../../server/internal/sync/http_connection.go#L194). On a `sync_frequency` write, publish an account event the sync connections already listen to and resend the frame.
- Per-device token bucket on workspace ops and record pushes, sized at about 3× what Balanced would send under continuous activity. Over budget: reply `workspace_error` / `records_ack` with code `sync_rate_limited` and `retry_after_ms`; never apply the op.
- Metrics in `http_metrics.go`: ops per device per minute, rate-limited replies.

Client:
- `ServerFrame::BatchPolicy` in [protocol.rs](../../src-tauri/crates/browser-sync/src/protocol.rs#L218); clamp, then `Batcher::set_policy`. Unknown lanes are ignored; a lower `revision` than the current one is ignored.
- `on_error`: handle `sync_rate_limited` before the structural arm. Remove the in-flight op, keep every queued edit, and hold the lane until `retry_after_ms` (clamped to 1–300 s). The same for `records_ack`.

Frontend: the `sync_frequency` row (see Settings UI above).

Tests: server sends the frame on connect and after a preset change; rate-limited op keeps all edits and republishes after the delay; client ignores out-of-range values and falls back to defaults; Go contract test for the setting definition.

## Load budget

Under continuous browsing (an edit every second), one device on Balanced sends at most one workspace op per 5 s instead of about one per round trip (2–4 per second on a fast link): roughly a 10–20× cut in workspace ops and the fan-out deltas they cause. An idle device sends nothing, as today. Measure before and after with the phase 1 counters and the server's ops-per-device metric.

## Decided

- Coalescing stays state-based (diff at publish time); no event log compaction on the wire.
- Policy is server-sent with a single account preset on top; no device-only override.
- Contended editing always uses near-live timing regardless of preset.
- The pre-workspace mutation log is not batched.
