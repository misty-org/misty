# Tauri File Explorer Parity Ledger

This is a current-state migration ledger for the File Explorer refactor from the native ImGui/C++ implementation to the Tauri/Rust/React implementation.

It is intentionally evidence-based: every row references the source area that currently proves the native behavior and the Tauri status. "Partial" means the visible workflow exists but still lacks one or more native behaviors.

## Source Map

| Area | Native C++ Evidence | Tauri Evidence |
| --- | --- | --- |
| Explorer shell, sidebar, toolbar, inspector, compare mode | `src/panels/file_explorer/file_explorer_panel.h`, `src/panels/file_explorer/file_explorer_panel.cpp` | `apps/desktop/src/features/explorer/ExplorerWorkspace.tsx` |
| Directory table/grid rendering | `src/panels/file_explorer/content/directory_content.cpp`, `src/panels/file_explorer/content/directory_content_util.cpp` | `apps/desktop/src/features/explorer/components/FileBrowser.tsx` |
| Explorer state and persistence | `src/panels/file_explorer/state/*`, `src/core/workspaces/workspace.*` | `apps/desktop/src/features/explorer/state/useExplorerStore.ts`, `apps/desktop/src-tauri/src/services/workspaces.rs` |
| Local/remote file operations | `src/core/file_master/*`, `src/panels/file_explorer/operations/*` | `apps/desktop/src-tauri/src/core/explorer.rs`, `apps/desktop/src-tauri/src/services/explorer.rs` |
| Clipboard | `src/core/clipboard/*`, `src/panels/file_explorer/state/clipboard_state.*` | `apps/desktop/src-tauri/src/core/clipboard/*`, `apps/desktop/src/features/explorer/state/useExplorerStore.ts` |
| File sync/compare | `src/core/file_sync/*`, `src/panels/file_explorer/state/file_sync_compare_state.h` | `apps/desktop/src-tauri/src/core/file_sync/*`, `apps/desktop/src-tauri/src/services/file_sync.rs`, `apps/desktop/src/features/explorer/state/useFileSyncStore.ts` |
| MultiPanel workspaces | `src/panels/panel/multi_panel.*`, `src/views/files_view.cpp` | `apps/desktop/src/shared/multipanel/*` |

## Feature Comparison

| Feature | Native C++ | Tauri Current | Status | Remaining Work |
| --- | --- | --- | --- | --- |
| Local directory listing | `list_directory` through local FileMaster/state | `core/explorer.rs::list_directory` via `ExplorerService` | Done | Add deeper metadata parity if native exposes more attributes later. |
| Remote virtual route browsing | Remote mount paths and FileMasterRemote | Virtual `.misty/mnt/provider/remote` routes through Providers + rclone proxy | Done | Keep route semantics aligned with provider mutations. |
| Cached remote listings | Native has listing state and refresh flow | `ListingCache` backs remote list fallback | Done | Add cache freshness controls if needed. |
| Split panes and top-level tabs | `MultiPanel` supports tabs/splits/restore | React `MultiPanelWorkspace` supports tabs with up to 4 split panes | Partial | Continue polishing exact native split ratios, focus, and restore edge cases. |
| Single shared toolbar for active pane | Native renders shell toolbar for active pane | Tauri toolbar is outside split pane contents and follows active pane | Done | Visual tuning only. |
| Sidebar quick access/devices/remotes | `FileSidebarPanel` plus devices state | Sidebar has quick access, pinned paths, provider remotes, devices from environment | Partial | Native device scanning/detail parity is incomplete. |
| Sidebar/preview resize and toggles | Native layout supports sidebar/inspector controls | Tauri has draggable sidebar/preview widths and bottom toggles | Done | Persisted min/max may need final UX tuning. |
| Directory list view | ImGui table with sticky header, resizable/reorderable/sortable columns | React table with sticky header, horizontal scrolling, sortable headers, persisted resizable widths/order, drag-reorderable columns, and virtualized rows | Done | Continue visual tuning only. |
| Directory grid view | Native grid items with icons and selection | Tauri grid view has virtualized rows, icons, drag/drop, selection, and inline create/rename support | Partial | Native icon set parity still missing. |
| Large directory performance | ImGui only draws visible rows | Tauri list and grid views now virtualize mounted rows | Done | Continue profiling very large remote folders during visual QA. |
| Header sorting | Native table sorting through ImGui sort specs | Store-owned sort by Name/Modified/Size/Type | Done | Add persisted per-pane/per-tab sort if global sort feels too coarse. |
| Search/filter current directory and commands | Native has search palette hooks and command/search integration for core explorer commands | Toolbar query filters visible file names/types/providers; `>` command mode runs refresh, rename, delete, copy, cut, paste, and toggle-hidden for the active pane | Partial | Full global command registry/search palette and chat command remain incomplete. |
| Selection | Native supports click, multi-select, range selection | Tauri supports single, meta/ctrl toggle, shift range | Done | Range selection over filtered views can include hidden-by-filter items indirectly. |
| Context menu | Native item/background menus for new/copy/cut/paste/rename/delete/pin/copy path/show hidden | Tauri menu exposes equivalent major actions | Done | Add keyboard accelerator labels and disabled reasons. |
| New file/folder | Native inline create/rename session | Tauri inserts a focused inline file/folder draft in list and grid views, validates sibling collisions/invalid names, and enqueues creation on Enter or blur | Done | Remote backends intentionally reject empty-file creation when rclone cannot represent it. |
| Rename | Native inline rename session with validation and multi-participant review | Tauri edits selected items inline in list and grid views, locks the original file extension, selects the editable basename when a rename session starts, preserves typing caret through validation updates, propagates multi-selection inline drafts across selected participants, opens a review dialog for batch edits, focuses invalid review rows, validates sibling collisions/invalid names, gathers selections across loaded panes, and queues batch renames | Partial | Passive multi-participant caret rendering and final review-modal polish remain incomplete. |
| Delete | Native delete modal/permanent delete paths | Tauri confirmation dialog for selected delete | Partial | Permanent delete/permission delete modal parity missing. |
| Copy/cut/paste local | Native FileMasterLocal through operation jobs | Explorer paste/drop/upload now enqueue one operation per item through `OperationQueueService`, which pumps ready operations into `ExplorerService` and transfer records; destination conflicts pause for queue resolution; Replace/Skip/Keep Both execute safely; and in-progress queue cancellations are observed between supported steps without late completion overwrites | Partial | Hard interruption of an already-running OS file copy still needs native parity. |
| Local-to-remote upload | Native FileMasterRemote upload via proxy/rclone | Rust upload through `ExplorerService::upload_local_item` | Done | Folder upload from picker is still missing. |
| Remote-to-local download | Native remote download operation | Rust download via `ExplorerService::download_remote_item` | Done for paste/download path | Double-click remote file temp-open is still missing. |
| Remote-to-remote copy/move | Native FileMasterRemote copy/cut | Rust rclone proxy copy/move jobs with queued retry, remote destination conflict preflight, and queue-level in-progress cancellation semantics | Partial | Hard cancellation of an already-running rclone proxy job still needs a proxy/job cancel endpoint. |
| Drag/drop between panes and OS | Native drag/drop selection helpers, delayed folder hover navigation, and pane drop zones | Tauri supports internal `application/x-misty-files` pane drops plus native OS file/folder drops through `onDragDropEvent`; drops route to the pane/folder under the cursor and folder rows auto-open after the native 3s hover delay | Partial | External OS drag-out remains missing. |
| Clipboard system integration | Native text/file/image clipboard service and cache | Tauri writes selected paths as text, stores Misty file-ref payloads, reads system clipboard text on paste, copies existing newline-delimited paths as file refs, and stages arbitrary text as `clipboard.txt` through the operation queue | Partial | Native file-ref MIME integration, image/html paste, and shared remote clipboard are not fully connected to OS clipboard. |
| Open local file | Native file association/application picker support | Tauri opens files through the OS default app or a remembered Open With association; remote files are prepared/cached first; stale associations are pruned | Partial | Dedicated association management UI for reviewing/removing mappings is still missing. |
| Open remote file | Native supports remote file download operations | Tauri prepares remote files through `explorer_prepare_open_item`, caches the downloaded local copy, and opens it through the OS opener on double-click | Done | Add explicit cache cleanup policy and richer progress UI if needed. |
| File picker upload | Native platform picker supports files/directories | Tauri dialog upload supports multiple files or folders and sends folder selections through queued directory upload | Done | Consider a combined picker/menu if the product wants one action instead of separate file/folder upload buttons. |
| Transfer history records | Native `FileTransfer` store and transfer UI | Rust `TransferService` records operations and React Transfers consumes them | Partial | Operation queue cancel/retry/undo integration remains incomplete. |
| Transfer-driven Explorer refresh | Native Explorer listens to `FileMasterTransfers` and relists the current directory when a completed transfer touches it | Tauri Explorer observes recent transfer snapshots, ignores historical rows on startup, and refreshes only panes whose current local or remote directory is touched by a newly completed transfer | Done | Replace polling with a push event if the Tauri runtime exposes transfer listeners later. |
| Operation queue/conflict handling | Native operation queue state and conflict/preserve order flows | Rust `core/operation_queue.rs` exists with tests, Tauri commands expose snapshot/cancel/retry/resolve/clear, Transfers shows queue state/conflict actions, create/rename/delete/paste all enqueue and pump through `OperationQueueService`, local and remote paste conflicts support Ask/Replace/Skip/Keep Both, failed payloads remain available for Retry, and in-progress cancellation no longer gets overwritten by late worker completion | Partial | Add hard cancellation for active OS/rclone jobs and richer batch conflict review. |
| File sync compare | Native compare/watch/apply flows | Rust sync core/service and React compare bar/results | Partial | Needs stronger parity QA for watched pairs, conflict review, and apply UX. |
| Workspace persistence | Native workspace snapshots under `core/workspaces` | Tauri restores/saves tabs, panes, path, sidebar/preview, sort/view state | Partial | Audit all native restore fields and sensitive-state exclusions. |
| Keyboard shortcuts | Native command manager bindings | Tauri handles common shortcuts in `ExplorerWorkspace` | Partial | Full command registry/palette parity missing. |
| Notifications/errors | Native centered transient notifications and error state | Tauri operation error pill plus transfer records | Partial | Native notification anchoring and richer status toasts missing. |
| Chat overlay | Native `TransientUiState` includes chat overlay state | No Tauri explorer chat overlay | Missing | Decide whether this remains in Explorer scope. |
| File associations manager | `src/core/manager/file_association_manager.*` | Tauri stores `open_with` mappings in settings using native-compatible keys, migrates legacy `~/.misty/open_with.json`, prunes missing app paths, launches selected apps through `explorer_open_with`, and provides a Settings panel for reviewing/removing remembered mappings | Done | Add richer association editing later only if product wants direct creation outside the Open With flow. |

## Current High-Priority Gaps

1. Finish native rename-session focus/caret behavior and review polish.
2. Complete rich clipboard file-ref MIME, image/html, and shared clipboard integration.
3. Add OS drag-out.
4. Finish the full global command/search palette and chat command.
5. Add hard cancellation for already-running OS file copies and rclone proxy jobs.

## Recent Tauri Improvements

- List view now virtualizes table rows in `FileBrowser.tsx`, reducing DOM churn for large directories.
- Grid view now virtualizes tile rows in `FileBrowser.tsx`, reducing DOM churn for large directories while preserving selection, drag/drop, and inline rename/create.
- File table scroll state is throttled to animation frames, reducing React churn while scrolling large directories.
- File list sort state now lives in `useExplorerStore.ts`, so sorted order is consistent for selection and workspace saves.
- Toolbar search now filters the visible directory entries by name, type, provider, and remote.
- File table columns can now be resized and their widths are persisted in localStorage.
- File table columns can now be drag-reordered and their order is persisted in localStorage.
- Remote files can now be opened from Tauri by preparing a cached local copy and then delegating to the OS opener.
- The upload toolbar now supports folder selection and queues directory uploads through the existing folder-aware Rust upload path.
- Native OS file/folder drops into the Tauri Explorer now resolve the target pane/folder and enter the background operation queue as copy/upload work.
- Internal and native OS drags now use delayed folder hover navigation, matching the native 3s hover-open behavior.
- The Explorer search field now has a `>` command mode for native-equivalent core explorer commands on the active pane.
- Operation queue snapshots/actions are now exposed through Tauri commands and visible in Transfers, including conflict resolution controls.
- Explorer paste/drop/upload now enqueue through `OperationQueueService` and pump onto background Explorer operations instead of blocking the UI on direct paste calls.
- Explorer create, rename, and confirmed delete now use the same background operation queue; multi-item deletes are split into independently retryable operations.
- Queued local paste conflicts now pause for resolution, preserve the operation payload while waiting, prune terminal payloads, and safely execute Replace/Skip policies.
- Queued local paste Keep Both now creates available sibling names such as `report copy.txt` and `report copy 2.txt`.
- Queued remote upload/download/copy/move now preflight destination conflicts through parent listings and honor conflict-generated target names end to end.
- Failed operation payloads now survive unrelated cancel/conflict actions so queue Retry remains executable until terminal history is cleared.
- In-progress operation cancellation now marks queue items canceled, unpauses conflict-blocked batches, signals running queue workers between supported steps, and prevents late worker completion from overwriting canceled state.
- New file/folder and single-item rename now use focused inline editors in list and grid views; file extensions remain locked, invalid/duplicate names stay editable with feedback, Enter commits, and Escape cancels.
- Multi-selection rename now opens a review dialog, validates all proposed names, preserves file extensions, and queues one background rename operation per changed item.
- Multi-selection rename now gathers selected items across loaded panes, validates collisions per source folder, and refreshes only the panes touched by the confirmed rename.
- Multi-selection inline rename now propagates the focused draft to every selected participant before opening the review dialog, matching native shared-draft rename behavior more closely.
- Inline rename/create now selects only the editable name portion when the session starts, keeps the caret stable during validation updates, ignores composing Enter/Escape key events, and focuses the first invalid batch-review row.
- Explorer now observes completed transfer history changes and refreshes only panes whose current directory was touched by the transfer, matching native transfer-listener relist behavior.
- Explorer now supports Open With for selected files, remembers the chosen application by extension/name in settings, and uses that mapping for later opens.
- Explorer table inline-edit styling no longer relies on a broad `:has()` selector in the scroll hot path.
- Open With association lookup now lives in the Tauri backend, matching native stale-path cleanup and legacy `~/.misty/open_with.json` migration behavior.
- Settings now includes an Open With Associations panel backed by Tauri commands for listing valid mappings, pruning missing app paths, and removing remembered associations without editing raw JSON.
- Paste now checks system clipboard text when there is no active cut payload, copies newline-delimited existing paths as file refs, and stages arbitrary text as `clipboard.txt` through the same operation queue used for local and remote paste/upload work.
- Transfers and operation-queue background polling now avoid visible working-state flips and skip React state replacement when snapshots are unchanged, reducing idle repaint churn in the migrated transfer surface.
- Explorer and Transfers polling now avoid overlapping snapshot requests, and Explorer workspace persistence/context-menu listeners avoid unnecessary resubscription churn during normal pane interaction.
