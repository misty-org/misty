# Traffic timer inventory

Companion to [the audit](traffic-control-audit.md), on the same `origin/main` baseline. Every directly declared recurring `setInterval`, Go ticker and Rust interval found by the scan below is classified. The additional table covers recursive timers, deadline loops and retry mechanisms; bounded process/UI waits are grouped by purpose. This does not claim to enumerate timers hidden inside dependencies or remote services.

## Direct recurring declarations

Found **63 declarations in 50 files**. Multiple declarations in a file are listed separately. A timer being present does not imply an HTTP request or an unconditional network send.

| Source | Scope | Cadence | Disposition | Audit |
|---|---|---|---|---|
| [server/internal/app/billing_adapter.go:27](../../server/internal/app/billing_adapter.go#L27) | DB/outbound billing delivery | 10s | Transactional queue hints and next retry deadline | T12 |
| [server/internal/app/run.go:72](../../server/internal/app/run.go#L72) | DB background queues | Social 2s; embeddings 15s; agent 2s; controls 3s; AI library 3s; rendition 2s; people 3s; maintenance 1min | Event-driven queues; separate bounded scheduled maintenance | T11/T12/T13 |
| [server/internal/app/run.go:116](../../server/internal/app/run.go#L116) | DB background queues | Social 2s; embeddings 15s; agent 2s; controls 3s; AI library 3s; rendition 2s; people 3s; maintenance 1min | Event-driven queues; separate bounded scheduled maintenance | T11/T12/T13 |
| [server/internal/app/run.go:132](../../server/internal/app/run.go#L132) | DB background queues | Social 2s; embeddings 15s; agent 2s; controls 3s; AI library 3s; rendition 2s; people 3s; maintenance 1min | Event-driven queues; separate bounded scheduled maintenance | T11/T12/T13 |
| [server/internal/app/run.go:152](../../server/internal/app/run.go#L152) | DB background queues | Social 2s; embeddings 15s; agent 2s; controls 3s; AI library 3s; rendition 2s; people 3s; maintenance 1min | Event-driven queues; separate bounded scheduled maintenance | T11/T12/T13 |
| [server/internal/app/run.go:176](../../server/internal/app/run.go#L176) | DB background queues | Social 2s; embeddings 15s; agent 2s; controls 3s; AI library 3s; rendition 2s; people 3s; maintenance 1min | Event-driven queues; separate bounded scheduled maintenance | T11/T12/T13 |
| [server/internal/app/run.go:195](../../server/internal/app/run.go#L195) | DB background queues | Social 2s; embeddings 15s; agent 2s; controls 3s; AI library 3s; rendition 2s; people 3s; maintenance 1min | Event-driven queues; separate bounded scheduled maintenance | T11/T12/T13 |
| [server/internal/app/run.go:214](../../server/internal/app/run.go#L214) | DB background queues | Social 2s; embeddings 15s; agent 2s; controls 3s; AI library 3s; rendition 2s; people 3s; maintenance 1min | Event-driven queues; separate bounded scheduled maintenance | T11/T12/T13 |
| [server/internal/app/run.go:230](../../server/internal/app/run.go#L230) | DB background queues | Social 2s; embeddings 15s; agent 2s; controls 3s; AI library 3s; rendition 2s; people 3s; maintenance 1min | Event-driven queues; separate bounded scheduled maintenance | T11/T12/T13 |
| [server/internal/platform/httpapi/abuse_guard.go:244](../../server/internal/platform/httpapi/abuse_guard.go#L244) | DB security-block refresh | 30s configured | Committed block notifications + reconnect reload | T28 |
| [server/internal/platform/httpapi/account_events.go:39](../../server/internal/platform/httpapi/account_events.go#L39) | SSE transport | 25s comment | Minimal transport exception only if measured necessary | T33 |
| [server/internal/platform/httpapi/agent_voice_realtime_session.go:120](../../server/internal/platform/httpapi/agent_voice_realtime_session.go#L120) | Active voice authorization/accounting | 20s while session active | Keep safety deadline/revocation semantics; coalesce shared checks | T32 |
| [server/internal/platform/httpapi/browser_agent_tools.go:137](../../server/internal/platform/httpapi/browser_agent_tools.go#L137) | DB per active waiter | 250ms | Job completion notification + deadline | T09 |
| [server/internal/platform/httpapi/realtime_connect.go:220](../../server/internal/platform/httpapi/realtime_connect.go#L220) | Space WebSocket transport | 30s ping | Minimal transport exception only if measured necessary | T33 |
| [server/internal/platform/httpapi/social_discord_gateway.go:78](../../server/internal/platform/httpapi/social_discord_gateway.go#L78) | External protocol | Server-negotiated heartbeat | Keep Discord-required heartbeat; fix reconnect policy separately | T33/T19 |
| [server/internal/platform/httpapi/workflow_device_v2.go:32](../../server/internal/platform/httpapi/workflow_device_v2.go#L32) | DB per active waiter | 250ms | Job completion notification + deadline | T09 |
| [server/internal/platform/metrics/metrics.go:135](../../server/internal/platform/metrics/metrics.go#L135) | Operational sampling and in-memory age | 15s sample default; 1s age ticker per sample | Keep bounded sampling; share query results and remove overlapping age tickers | T29 |
| [server/internal/platform/metrics/metrics.go:176](../../server/internal/platform/metrics/metrics.go#L176) | Operational sampling and in-memory age | 15s sample default; 1s age ticker per sample | Keep bounded sampling; share query results and remove overlapping age tickers | T29 |
| [server/internal/sync/http_connection.go:286](../../server/internal/sync/http_connection.go#L286) | Socket/DB | 15s ping; ~60s reconcile | Separate keepalive from DB; replace recovery polling with reset/replay | T06/T14/T33 |
| [server/internal/sync/http_connection.go:292](../../server/internal/sync/http_connection.go#L292) | Socket/DB | 15s ping; ~60s reconcile | Separate keepalive from DB; replace recovery polling with reset/replay | T06/T14/T33 |
| [src-tauri/crates/browser-sync/src/worker.rs:1150](../../src-tauri/crates/browser-sync/src/worker.rs#L1150) | Local queue checks / sync socket | 250ms tick; 15s heartbeat | Queue wake/deadlines; socket on-demand presence | T06/T23 |
| [src-tauri/crates/browser-sync/src/worker.rs:1152](../../src-tauri/crates/browser-sync/src/worker.rs#L1152) | Local queue checks / sync socket | 250ms tick; 15s heartbeat | Queue wake/deadlines; socket on-demand presence | T06/T23 |
| [src-tauri/src/infra/browser_sync/capture.rs:56](../../src-tauri/src/infra/browser_sync/capture.rs#L56) | Cookie/storage capture; possible sync | 2s | Native observers and dirty capture; platform fallback only if necessary | T23 |
| [src-tauri/src/infra/browser_sync/history.rs:98](../../src-tauri/src/infra/browser_sync/history.rs#L98) | Local history scan; queues changed records | 60s | History dirty/collection events + retention deadline | T23 |
| [src-tauri/src/infra/connected_devices.rs:1683](../../src-tauri/src/infra/connected_devices.rs#L1683) | Disk scan -> peer invalidation on change | 1s | Shared OS directory watches | T25 |
| [src-tauri/src/infra/space_peer_files.rs:89](../../src-tauri/src/infra/space_peer_files.rs#L89) | Disk scan -> peer invalidation on change | 1s | Shared OS directory watches | T25 |
| [src-tauri/src/platform/mini_app_file_index.rs:188](../../src-tauri/src/platform/mini_app_file_index.rs#L188) | Local worker authority checks | 100ms while operation active | Cancellation notification + deadline | T36 |
| [src-tauri/src/platform/mini_app_peer.rs:243](../../src-tauri/src/platform/mini_app_peer.rs#L243) | Local authority checks around peer work | 100ms at three sites | Cancellation/revocation channels and exact lease deadlines; preserve checks | T36 |
| [src-tauri/src/platform/mini_app_peer.rs:255](../../src-tauri/src/platform/mini_app_peer.rs#L255) | Local authority checks around peer work | 100ms at three sites | Cancellation/revocation channels and exact lease deadlines; preserve checks | T36 |
| [src-tauri/src/platform/mini_app_peer.rs:591](../../src-tauri/src/platform/mini_app_peer.rs#L591) | Local authority checks around peer work | 100ms at three sites | Cancellation/revocation channels and exact lease deadlines; preserve checks | T36 |
| [src/app/layouts/AppPagesLayout.tsx:37](../../src/app/layouts/AppPagesLayout.tsx#L37) | Credential refresh path | 10min | Use token expiry/auth transitions; avoid unconditional refresh | T05/T36 |
| [src/app/layouts/DesktopLayout/useDesktopBootstrap.ts:81](../../src/app/layouts/DesktopLayout/useDesktopBootstrap.ts#L81) | Local discovery; possible index/upload work | Account-configured discovery interval | File/provider notifications; documented unsupported-provider fallback | T25/T36 |
| [src/features/activity/useOperationActivity.ts:26](../../src/features/activity/useOperationActivity.ts#L26) | Local IPC | 5s | Native operation queue events | T24 |
| [src/features/agents/AgentWorkerRoot.tsx:138](../../src/features/agents/AgentWorkerRoot.tsx#L138) | Local task queue IPC | 1.5s | Existing agent-task-queued event plus task-completion wake | T24 |
| [src/features/agents/companion/companionVoice.ts:172](../../src/features/agents/companion/companionVoice.ts#L172) | Voice WebSocket control | 20s while connected | Unify necessary transport keepalive; no DB presence | T33 |
| [src/features/agents/companion/companionVoicePlayback.ts:22](../../src/features/agents/companion/companionVoicePlayback.ts#L22) | Local audio watchdog | Active playback only | Ended/progress events plus bounded watchdog; no server traffic | T36 |
| [src/features/agents/localExecution.ts:164](../../src/features/agents/localExecution.ts#L164) | HTTP + native active lease | 10s while execution active | Shared socket renewal/challenge; preserve lease fences | T32 |
| [src/features/agents/worker.ts:43](../../src/features/agents/worker.ts#L43) | HTTP presence / active job lease | 30s presence; 20s active lease | Remove idle presence poll; event/job socket and fenced renewals | T07/T32 |
| [src/features/agents/worker.ts:142](../../src/features/agents/worker.ts#L142) | HTTP presence / active job lease | 30s presence; 20s active lease | Remove idle presence poll; event/job socket and fenced renewals | T07/T32 |
| [src/features/browser-workspace/DeviceControlContent.tsx:63](../../src/features/browser-workspace/DeviceControlContent.tsx#L63) | Local sync IPC | 1s while mounted | Existing misty:browser-sync-changed event/shared store | T24 |
| [src/features/browser-workspace/SyncDeviceList.tsx:67](../../src/features/browser-workspace/SyncDeviceList.tsx#L67) | Local sync IPC | 2s while mounted | Existing misty:browser-sync-changed event/shared store | T24 |
| [src/features/browser-workspace/restore/capture.ts:28](../../src/features/browser-workspace/restore/capture.ts#L28) | Local capture; can enqueue sync | 3s; up to 40 tabs | Page dirty/navigation events; preserve privacy filtering | T23 |
| [src/features/browser-workspace/restore/restorer.ts:78](../../src/features/browser-workspace/restore/restorer.ts#L78) | Local page readiness | 1s, max 10min, pending tabs only | Load-ready events plus restore deadline | T36 |
| [src/features/browser/library/downloadsStore.ts:41](../../src/features/browser/library/downloadsStore.ts#L41) | Local IPC; active downloads | 500ms | Native download-progress event, throttled | T36 |
| [src/features/browser/workspace/BrowserDownloadsButton.tsx:33](../../src/features/browser/workspace/BrowserDownloadsButton.tsx#L33) | UI only | 30s | Keep relative-time display; no I/O | T36 |
| [src/features/browser/workspace/useBrowserPagePreview.ts:32](../../src/features/browser/workspace/useBrowserPagePreview.ts#L32) | Local capture only | 15s, visible active page | Paint/navigation/dirty capture; do not count as server bytes | T36 |
| [src/features/capability-approvals/CapabilityApprovals.tsx:133](../../src/features/capability-approvals/CapabilityApprovals.tsx#L133) | UI deadline display | 1s | Keep clock or arm exact expiry; no status fetch | T36 |
| [src/features/connected-devices/useConnectedDevices.ts:238](../../src/features/connected-devices/useConnectedDevices.ts#L238) | HTTP + peer setup | 30s + focus | Presence/key/peer events and on-demand probe | T07 |
| [src/features/files/workspace/connected-devices/ConnectedDevicePairingDialog.tsx:42](../../src/features/files/workspace/connected-devices/ConnectedDevicePairingDialog.tsx#L42) | HTTP; pending pairing dialog | 1.5s | Pairing state event + expiry timer | T20 |
| [src/features/files/workspace/explorer/store/helpers/view_size.ts:82](../../src/features/files/workspace/explorer/store/helpers/view_size.ts#L82) | Local/remote filesystem query | 30min | Directory invalidation and demand; provider fallback only if needed | T25/T36 |
| [src/features/files/workspace/explorer/workspace/ExplorerToolbarConnections.tsx:72](../../src/features/files/workspace/explorer/workspace/ExplorerToolbarConnections.tsx#L72) | Local operation queue IPC | 5s | Operation queue events/shared snapshot | T24 |
| [src/features/files/workspace/explorer/workspace/explorerWorkspace/useTransferRefreshPolling.ts:30](../../src/features/files/workspace/explorer/workspace/explorerWorkspace/useTransferRefreshPolling.ts#L30) | Local/remote transfer refresh | 12s + initial 1s | Transfer completion and directory invalidation events | T25/T36 |
| [src/features/global-search/MistyActivityStatus.tsx:37](../../src/features/global-search/MistyActivityStatus.tsx#L37) | UI only | 4s while active | Keep animated status text; no I/O | T36 |
| [src/features/home/HomeDashboard.tsx:267](../../src/features/home/HomeDashboard.tsx#L267) | UI only | 1s | Keep display clock; no I/O | T36 |
| [src/features/library/library/libraryViewer/useLibraryEditVersions.ts:87](../../src/features/library/library/libraryViewer/useLibraryEditVersions.ts#L87) | HTTP; pending renditions only | 1.5s | Rendition completion/version event | T20 |
| [src/features/navigation-names/NavigationNamesBoundary.tsx:78](../../src/features/navigation-names/NavigationNamesBoundary.tsx#L78) | Local file/IPC | 2s + focus | Native file-change events | T24 |
| [src/features/scheduled/ScheduledTasksBridge.tsx:24](../../src/features/scheduled/ScheduledTasksBridge.tsx#L24) | HTTP; signed-in desktop | 60s + focus | Replace with task/run events | T20 |
| [src/features/settings/profiles/SettingsProfilesBridge.tsx:84](../../src/features/settings/profiles/SettingsProfilesBridge.tsx#L84) | HTTP + projection | 30s | Remove recovery poll after reset/reconnect handling | T03/T04 |
| [src/features/settings/sections/SearchSection.tsx:44](../../src/features/settings/sections/SearchSection.tsx#L44) | Local IPC | 700ms scanning / 5s idle | Search progress events; share with search store | T24 |
| [src/features/spaces/components/spacePanel/useAgentUsage.ts:34](../../src/features/spaces/components/spacePanel/useAgentUsage.ts#L34) | HTTP; panel scoped | 5min | Usage/run-finished events | T20 |
| [src/features/spaces/components/spacePanel/useSpaceLibraryUsage.ts:48](../../src/features/spaces/components/spacePanel/useSpaceLibraryUsage.ts#L48) | HTTP; panel scoped | 5min | Storage/library revision events | T20 |
| [src/features/updater/UpdateNotices.tsx:51](../../src/features/updater/UpdateNotices.tsx#L51) | Release manifest HTTP | 30min + focus; 5min floor | Release hints + cached long jittered fallback/manual check | T31 |
| [src/features/workspace/useWorkspacePagePreview.ts:73](../../src/features/workspace/useWorkspacePagePreview.ts#L73) | Local capture only | 15s | Dirty/paint event; snapshots explicitly excluded from sync | T36 |

## Other repeated work and retry/deadline paths

| Source / mechanism | Current behavior | Disposition |
|---|---|---|
| `src/api/client/http.ts` | Up to three idempotent GET attempts, 150/350ms + tiny jitter | Shared exponential, bounded retry and Retry-After; prevent nested retry amplification (T19) |
| `src/api/accountEvents.ts` | Capped exponential SSE retry, stops on 401/403; 250ms event coalescing | Preserve good behavior; shared auth gate, scoped reset and shared snapshot reads (T05/T17/T18) |
| `src/api/client/cookie-session.ts` | Per-generation single-flight refresh with cached failure | Preserve; coordinate all request families and window generation changes (T05) |
| `src/features/spaces/store/createSpacesRealtimeActions.ts` | Exponential retry; attempt resets immediately on open | Stable-success reset, full jitter, terminal-auth stop and listener-outage reset (T16/T19) |
| `src/features/ai-surface/invocationStream.ts` | Three linear retries; resumes Last-Event-ID | Exponential jitter, retain cursor and no replay of task creation (T19) |
| `src/features/connected-devices/useConnectedDevices.ts` | Fixed 30s builtin-service restart | Backoff/jitter and terminal-error classification (T19) |
| `src/features/browser-workspace/BrowserSyncStartup.tsx` | Healthy native worker inspected every 30s; failed workers reopened at capped 30s–5min delay without jitter | Subscribe to worker terminal-state changes; preserve failure cooldown and add jitter (T05/T19/T24) |
| `src/features/browser-workspace/controller.ts` | Debounced capture, deadline and failed-write retry | Keep event-triggered batching; semantic dirty checks and idempotent capped failure retries (T22) |
| `src/features/workspace/useWorkspaceRecoveryRetry.ts`, `nativeWorkspaceRecovery.ts` | Recovery/retry timers on main; PR #212 changes this area | Reconcile with #212 before editing; retain durable local saving and backoff |
| `src/features/files/workspace/search/store/useSearchStore.ts` | Recursive 500ms active / 5s idle status polling while open/scanning | Shared native search status event (T24) |
| `src-tauri/crates/browser-sync/src/worker.rs` | Network retry with exponential jitter; auth/protocol errors terminal | Preserve; event-driven queue wake and deadline checks (T06/T23) |
| `src-tauri/crates/browser-sync/src/worker/collections.rs` | Three collection safety pulls every 300s; 2s hint debounce | Remove safety pulls once reset/gap coverage is proven; preserve burst coalescing (T14) |
| `src-tauri/src/infra/browser_sync/control_advertisement.rs` | Failed control advertisement retried at fixed 30s | Exponential jitter, terminal error gate, cancel on account change (T19) |
| `src-tauri/src/domain/file_sync/master.rs` / `infra/file_sync.rs` | Enabled watch pairs compare every 5s | Filesystem/provider/peer notifications and bounded fallback (T25) |
| `src-tauri/src/domain/file_sync/poller.rs` | Generic remote snapshot scanner at caller interval | Verify production wiring; use change streams/cursors or document no-stream provider fallback (T25) |
| `src-tauri/src/domain/file_sync/watcher.rs` | Recursive local metadata snapshot at caller interval | OS file watcher, shared root subscriptions (T25) |
| `server/internal/platform/httpapi/ai_invocations.go` | Per-stream DB/history refresh on 15s keepalive and every event | Incremental shared stream hub; transport comments without DB access (T10) |
| `server/internal/platform/httpapi/workflow_runtime_v2_execute_workflow_node_v2.go` | Resource lease retries every 500ms while contended | Release notifications and next-expiry deadline, no tight DB retry (T09) |
| `server/internal/platform/httpapi/social_discord_gateway.go` | Fixed 5s reconnect after gateway failure | Backoff/jitter and Discord-requested protocol behavior (T19/T33) |
| `server/internal/platform/httpapi/realtime_config.go` | LISTEN connection ping after 45s idle | Document low-cost DB-listener liveness or use library/connection health; restore clients on listener reconnect (T16) |
| `server/internal/platform/httpapi/account_events.go` | Forced SSE expiry after 10min | Credential-deadline revalidation/revocation; justify and jitter any remaining lifetime (T15) |
| `server/internal/sync/http_connection.go` | Jittered forced socket expiry at ~10min | Same as above; avoid growing expired connection records (T08/T15) |
| `server/apps/self-host-collab/index.ts` | 2s save debounce becomes fixed retry on failure; saves on disconnect | Dirty/single-flight bounded saves, exponential retries, byte/queue limits (T26/T27) |
| `src/features/collaboration/createYjsProvider.ts` | Reconnection and awareness timers delegated to provider; BroadcastChannel disabled | Verify installed SDK; configure consistent backoff and bound idle document residency (T18/T19) |
| `src/telemetry/client.ts` | External SDK flush cadence not explicitly configured | Verify pinned SDK and set low-priority bounded batching (T30) |
| `src-tauri/src/telemetry.rs`, `server/internal/platform/telemetry/client.go` | Blocking queue consumers send each event | Already no empty polling; batch actual queued events (T30) |

## Timers retained or converted for an explicit reason

| Family | Evidence / reason | Decision |
|---|---|---|
| UI clocks, relative time, status phrase rotation and visual animations | `HomeDashboard`, `CapabilityApprovals`, `BrowserDownloadsButton`, `MistyActivityStatus`; local state only | Keep or reduce redraw cadence; no server requests |
| Active execution leases and voice authorization | `localExecution`, `agents/worker`, `agent_voice_realtime_session` protect expiry, cancellation and authorization | Move to control-socket/deadline model; do not remove safety behavior |
| Discord heartbeat | `social_discord_gateway.go` uses interval supplied by gateway | Keep protocol-required heartbeat; reconnect with backoff |
| HTTP/WebSocket/SSE transport deadlines and keepalives | Proxy/NAT idle limits must be tested; current read deadlines expect pongs | Retain only minimum proven necessary, server-driven; no database heartbeat writes |
| Observability sampling / health probes | `metrics.go`, domain gauges, Docker `/health` | Keep low-rate bounded operations monitoring; eliminate redundant count queries |
| Scheduled jobs, retention and lease expiry | Time passage emits no notification | Use next-deadline timers, bounded indexed cleanup and distributed ownership |
| External file/cloud providers without change streams | Generic file-sync remote scanner; actual provider support still needs validation | Prefer push; only keep jittered adaptive polling with a written provider-specific reason |
| Native authority/cancellation watchdogs | `mini_app_peer`, `mini_app_file_index`, document/file/process workers | Replace with channels/deadlines; preserve revocation and cancellation guarantees |
| Native process I/O waits | `mini_app_download_process`, `mini_app_media_process`, `mini_app_document_processing`, `mini_app_download_proxy`, `native_process_worker`, `operation_queue`, `media_search` | Evented I/O/process completion where possible; bounded active-operation waits are not server traffic |
| Native browser readiness/action verification | `browser_render_probe`, `browser_popup_probe`, `browser_agent_files_probe`, `browser_website_storage`, frontend agent restore/normal-tabs helpers | Event callbacks where available; bounded post-action observations may remain because readiness is asynchronous |
| Clipboard, tray and local companion observations | `native_clipboard` 500ms, `tray` 3s, companion platform/host waits | OS notifications or bounded local fallback; no automatic server-byte claim |
| Browser action reconciliation | `server/internal/browseractions/executor.go`, `agents/tier.go` | Bounded verification retries are tied to a user/agent action; do not replay uncertain effects |
| Upload processing/materialization waits | `src/api/journal/assets.ts`, media-search chunk wait, workflow cooldown | Keep bounded operation/deadline semantics; backoff for network retries |
| One-shot debounce, UI cleanup and explicit workflow wait nodes | Search-input debounce, drawing cursor batching, layout saves, shutdown deadline, cooldown | Keep; these batch real changes or implement requested timing rather than discover remote state |

## Search method

Used `rg` and tracked-source inspection for `setInterval`, `setTimeout`, `refetchInterval`, `pollInterval`, `NewTicker`, `Tick`, `NewTimer`, `time.After`, `time.Sleep`, Rust `interval`/`sleep`, stream constructors, reconnect/backoff, notification channels and event consumers. Direct table excludes tests/examples/generated/vendor code. Rust files can also contain bounded test helpers; those are not production traffic findings. Server app sources were scanned separately, including Yjs persistence and workflow runtime. Static classification is complete for the directly matched declarations on this base; runtime profiling is still required for library-owned behavior and suspected feedback loops.

## Implementation delta (first batch)

The inventory above is the audited baseline. Removed: the 30-second settings refresh and both 250-millisecond device-job completion polls. Settings now use account events/reset/focus/online recovery; completion waiters use committed job-state notifications, reset recovery and actual deadlines. The metrics sampler remains an observability timer, but its per-pass one-second age tickers have been removed. All other inventory entries still require implementation or an explicitly justified exception.


## Implementation delta (durable worker queues)

Removed seven more recurring scan timers: billing (10s), social delivery (2s), embeddings (15s), note/drawing controls (3s), Library AI (3s), renditions (2s) and faces (3s). The controls timer formerly serviced three queues; these now have independent deadline planners, including acknowledged drawing purges. Empty queues have no timer. Startup/reconnect and committed PostgreSQL hints initiate reads; real retry/lease/scheduled deadlines arm one-shot timers. Errors and contested ready rows retain capped exponential retries with jitter while pending work exists. Disabled processors remain idle.

Retained connection-health mechanism: one shared worker LISTEN session per API process uses TCP keepalive probes after 30s idle, at 10s intervals with 3 missed probes. This detects silent connection failure so reconnect can rescan durable queues; it sends no SQL state query and is independent of user/device count. Measure its wire cost in the deployment's network path. The Personal Agent 2s dispatcher and 1min maintenance loop still require conversion; neither is claimed fixed by this batch.


## Implementation delta (abuse propagation)

Removed the 30-second abuse-block refresh ticker. Committed changes and LISTEN reconnects trigger a coalesced authoritative snapshot, with a 100ms minimum gap during bursts and no timer while unchanged. Local expiry checks use the request's current time without I/O. Pending failed writes use a single bounded writer with exponential backoff; it exits when the map has no unpersisted active blocks. Expired database rows use their actual expiry plus the existing one-day grace period and bounded deadline-driven deletion, rather than cleanup inside every snapshot read. The shared PostgreSQL listener and its already documented connection-health probes are reused.


## Implementation delta (resource leases)

Removed the workflow resource lease's 500ms contention poll. Each waiter now subscribes to a resource-specific committed hint before claiming and arms only the current lease holder's actual database-clock deadline. Unrelated resource transitions cause no reads. LISTEN reconnect triggers reconciliation; cancellation or a closed subscription stops the waiter. A five-second one-shot deadline bounds post-action release. These use the existing shared listener, not a PostgreSQL session per resource/waiter.


## Implementation delta (AI invocation streams)

Removed the AI invocation SSE loop's per-viewer database refresh on every event and every 15-second keepalive. Viewers share one per-invocation stream fed by committed PostgreSQL hints and incremental, bounded page reads. Keepalive comments are transport-only. Expiry uses the invocation's own deadline, not a timer poll.
