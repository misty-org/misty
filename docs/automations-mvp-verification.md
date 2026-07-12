# Automations desktop MVP verification

Verified July 11, 2026.

## Supported flow

The desktop editor supports creating, selecting, dragging, connecting, disconnecting, configuring, copying, cutting, pasting, duplicating, deleting, undoing, redoing, and fitting nodes. Workflow settings and the run log are resizable popovers/panels, unsaved workflow switches are guarded, and Escape closes editor modes or inspectors even when a form control has focus.

Workflows persist under Misty's versioned automation store. Manual, interval, and local webhook triggers execute only the branch reachable from the matching trigger. Enabled intervals are claimed by a backend scheduler while Misty is running, independent of whether the Automations page is open. A claim is persisted before execution, missed intervals run once without backfill, and stale editor saves cannot reset scheduler-owned timestamps.

Read, filter, prompt, HTTP, notification, and file-action nodes record per-node output or failure details. HTTP integrations have a 30-second timeout and non-2xx responses fail the run with a bounded error. Write, copy, move, and rename nodes remain terminal and require explicit approval. Approving or rejecting updates both the approval and node/run status; deleting a workflow removes its associated run and approval history.

The webhook listener binds only to `127.0.0.1`. Disabled workflows reject schedule and webhook execution. Successful webhook responses expose only acceptance, run ID, and status rather than the full automation store.

## Verification record

- `npm run build:desktop`: passed (TypeScript and Vite production build).
- `cargo test services::automations --lib`: 13 passed.
- `cargo test --lib -- --test-threads=1`: 236 passed. Under parallel load, the pre-existing `undo_then_redo_local_move_uses_backend_redo_stack` operation-queue timing test was intermittent; it passed in isolation, in one parallel full run, and in the deterministic serial full run.
- `git diff --check`: passed.
- Native debug runtime: Misty launched successfully and `GET http://127.0.0.1:17832/health` returned `Misty automations ready`.
- Editor interaction smoke pass at the desktop viewport: click placement, palette drag/drop, node movement, inspector Escape, connect/disconnect, undo/redo, copy/paste/duplicate, workflow settings, fit-to-view, and run-log resizing passed.
- Service end-to-end tests use isolated temporary stores and files to prove save/reload/manual run, interval claiming, webhook routing, HTTP failure, approval-gated writes, rejection state, and workflow-history deletion.
- Strict repository-wide Clippy is not currently clean because of 25 existing warnings in unrelated modules; none were reported in the automation service before Clippy stopped the build.

## Intentional V1 constraints

- Schedules run only while Misty is open and do not backfill every missed interval.
- File mutations are terminal workflow nodes and always require approval.
- Webhooks are local-machine integrations, not remotely hosted endpoints.
- Run history is capped at the latest 100 runs.
