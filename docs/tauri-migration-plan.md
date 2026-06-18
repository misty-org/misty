# Tauri Migration Plan

This document is the working migration contract for moving Misty from the current
C++/ImGui shell to a Tauri app. The goal is not to translate ImGui panels line by
line. The goal is to preserve Misty's product behavior and rebuild the UI with a
faster iteration loop.

## Current Shape

Misty is currently a native CMake app with these broad layers:

- `src/application.*`: owns the platform shell, frame loop, view registration,
  global state registry, worker pool, clipboard service, plugin startup, and
  transfer hydration.
- `src/core/*`: mostly product/service logic, but some pieces are still tied to
  native C++ process, platform, or ImGui-era state patterns.
- `src/panels/*`: mixed UI rendering, view state, domain state, workflows, and
  orchestration. These should not be ported as UI components. Useful state and
  workflow logic should be extracted into backend services or frontend stores.
- `src/views/*`: ImGui view shell. This should be replaced by Tauri routes,
  layouts, and workspace components.
- `src/dfs/*`: DFS/gRPC-era server/client pieces. These need a separate pass to
  decide whether they remain a side service, become Tauri commands, or are
  retired.

There is not currently a first-class top-level Tauri app in this repo.

## Migration Thesis

Use Tauri as the new product shell:

- Rust backend owns IO, process management, filesystem work, rclone/proxy calls,
  transfer execution, persistence, file sync, and native integrations.
- TypeScript frontend owns UI layout, component state, multipanel workspaces,
  filters, tables, forms, optimistic UI, and rendering polish.
- Backend emits events for long-running work. Frontend invokes commands and
  subscribes to updates.
- Do not make TypeScript responsible for core multithreaded work.

The C++ work is not useless. It is the behavior spec and the reference
implementation. The migration should port concepts and data contracts, not the
immediate-mode rendering code.

## Core Inventory

### Keep As Backend Services

These systems should become Rust/Tauri services:

- `core/file_master/*`
  - Local file operations: list, rename, remove, copy, move.
  - Remote operations through rclone/proxy: list, remove, rename, copy, move,
    upload, download, mkdir.
  - Current C++ uses `WorkerPool` plus `FileTransfer` tracking.
- `core/file_transfer/*`
  - Transfer records, lifecycle, progress, retry/undo flags, history pruning.
  - SQLite-backed persistence and async write queue.
  - Should become a Rust `TransferService` with an event broadcast stream.
- `panels/providers/state/*`
  - Although it lives under `panels`, this is service logic: rclone health,
    remotes, workflows, add/reconnect/repair flows, config get/update, remote
    rename, testing, diagnostics.
  - Split into `ProviderService` backend plus per-workspace frontend store.
- `core/manager/proxy_manager.*`
  - Launch/probe/restart the local `misty-proxy` process.
  - In Tauri this should be a managed sidecar or explicit child process service.
- `core/net/http_client.*`
  - Replace with Rust `reqwest` for normal requests, streaming, uploads,
    downloads, progress, timeouts, cancellation, and proxy auth injection.
- `core/file_sync/*`
  - Watcher, remote poller, gate, runner, reconciliation loop.
  - This maps naturally to Tokio tasks plus channels.
- `core/clipboard/*`
  - Native clipboard watcher, local/shared payloads, proxy shared clipboard.
  - In Tauri, use Rust clipboard APIs or a Tauri plugin plus a backend service.
- `core/manager/settings_manager.*`, `core/db.*`, `core/workspaces/*`
  - Port to typed persistence and app settings APIs.

### Rewrite As Frontend

These systems should be rebuilt in TypeScript/React rather than ported:

- `panels/*/content`, `panels/*/layout`, `panels/*/navigation`
- `views/*`
- `core/ui/*`
- ImGui table/form/modal code
- ImGui `MultiPanel` renderer

The frontend should keep the product ideas: multipanel workspaces, provider
editor, transfer filters/detail, file explorer panes, settings pages.

### Decide Later

- `core/plugins/*` and plugin UI hosting need a separate design. The current
  plugin manager is deeply native/C++ oriented. A Tauri design may use sidecars,
  WebView-based plugin panels, WASM, or a separate process model.
- `dfs/*` may be preserved if still strategic, but it should not block the first
  Tauri shell.

## Threading And Concurrency

The concern that "Tauri or TypeScript does not have multithreading" is only true
for the webview renderer in the usual browser sense. Tauri's backend is Rust,
and Rust has excellent multithreading.

Recommended mapping:

| Current C++ Pattern | Tauri/Rust Replacement |
| --- | --- |
| `WorkerPool` fixed threads | `tokio::spawn` for async IO, `tokio::task::spawn_blocking` for blocking filesystem/CPU work |
| `std::thread` long-running service | Owned Tokio task with `CancellationToken` or a dedicated `JoinHandle` |
| `std::mutex` shared state | `Arc<RwLock<T>>` or `Arc<Mutex<T>>`; prefer `RwLock` for state snapshots |
| `condition_variable` queue | `tokio::sync::mpsc` or `flume` channel |
| transfer listeners | `tokio::sync::broadcast` plus `app.emit`/frontend event subscriptions |
| async write queue | background writer task fed by `mpsc` |
| remote transfer concurrency cap | `tokio::sync::Semaphore` |
| hydration polling | startup task that emits `transfers://hydrated` when ready |
| UI reads state every frame | frontend calls snapshot commands and listens to events |

TypeScript can use Web Workers for UI-side CPU work if needed, but Misty's heavy
work should live in Rust.

## Proposed Tauri Backend Shape

Create a Tauri app with a shared runtime state:

```rust
pub struct MistyRuntime {
    pub proxy: ProxyService,
    pub providers: ProviderService,
    pub transfers: TransferService,
    pub file_master: FileMasterService,
    pub clipboard: ClipboardService,
    pub settings: SettingsService,
}
```

Expose commands first for the highest-value panels:

```rust
#[tauri::command]
async fn providers_snapshot(state: tauri::State<'_, MistyRuntime>) -> Result<ProvidersSnapshot, ApiError>;

#[tauri::command]
async fn providers_select_remote(name: String, state: tauri::State<'_, MistyRuntime>) -> Result<RemoteEditDraft, ApiError>;

#[tauri::command]
async fn providers_save_remote(request: SaveRemoteRequest, state: tauri::State<'_, MistyRuntime>) -> Result<RemoteEditDraft, ApiError>;

#[tauri::command]
async fn transfers_snapshot(filter: TransferFilter, state: tauri::State<'_, MistyRuntime>) -> Result<TransferPage, ApiError>;

#[tauri::command]
async fn file_list(request: FileListRequest, state: tauri::State<'_, MistyRuntime>) -> Result<FileListResponse, ApiError>;
```

Emit events for live updates:

- `providers://changed`
- `providers://health`
- `transfers://changed`
- `transfers://progress`
- `file-sync://event`
- `clipboard://changed`
- `proxy://status`

Frontend stores should use these commands/events rather than duplicating backend
state machines.

## Migration Order

1. Scaffold `apps/desktop` as the Tauri app while keeping the current C++ app
   buildable.
2. Define shared TypeScript API types for Providers and Transfers.
3. Implement Rust `ProxyService`, rclone/proxy HTTP client, and minimal
   diagnostics commands.
4. Port Providers service:
   - health
   - workflows
   - remotes
   - config get/update
   - rename/disconnect/test/reveal config
5. Build the Providers UI in Tauri as the first serious panel.
6. Port `TransferService` and transfer history persistence.
7. Build Transfers UI with multipanel/filter/detail behavior.
8. Port file listing and basic local/remote operations.
9. Port file explorer UI.
10. Port settings, clipboard, plugins, and file sync in separate slices.
11. Keep the ImGui app as a reference until each Tauri slice is verified.

## First Slice Acceptance Criteria

The first useful Tauri milestone should prove:

- Tauri app launches locally.
- Backend can start/probe proxy/rclone status.
- Providers page lists remotes and diagnostics.
- Selecting a remote loads config through backend command.
- Saving a config update uses rclone RC `config/update`.
- Long-running calls never block the UI.
- Backend emits updates and frontend refreshes without polling every frame.

## Risks

- Rewriting panel code 1:1 would preserve ImGui compromises in a web app. Avoid
  this.
- Providers state currently lives under `panels/`; it must be split carefully so
  service logic does not remain coupled to UI workspace state.
- Secrets must not be serialized into frontend persistence, window snapshots, or
  debug logs.
- File operations need cancellation and progress semantics from the beginning,
  or Transfers will regress.
- Plugin hosting needs a separate design before promising parity.

## Recommendation

Commit to Tauri for the main user-facing app, but migrate by vertical slices.
Do not delete the C++ app yet. Use it as the authoritative behavior reference
until the Tauri version has Providers, Transfers, and File Explorer working with
the same backend semantics.

