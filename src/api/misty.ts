import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type {
  AiSendRequest,
  AiStatus,
  AiStreamEvent,
  AppSnapshot,
  AppEnvironmentSnapshot,
  ClaudeSendRequest,
  ClaudeStatus,
  ClaudeStreamEvent,
  ClipboardPayload,
  ClipboardSnapshot,
  CreateItemRequest,
  DeleteItemsRequest,
  DeviceSnapshot,
  DirectorySizeRecord,
  DirectorySizeRequest,
  DirectoryListing,
  ExplorerOperationResult,
  ExplorerPreviewPayload,
  ExplorerLibraryItem,
  ExplorerLibrarySnapshot,
  FileEntry,
  FileSyncApplyRequest,
  FileSyncApplyResult,
  FileSyncCompareRequest,
  FileSyncCompareResult,
  FileSyncPair,
  LaunchOnLoginSnapshot,
  ListDirectoryRequest,
  NativeWorkspaceDocument,
  OpenWithAssociation,
  OperationConflictPolicy,
  OperationQueueSnapshot,
  PasteBlobRequest,
  PasteItem,
  PasteItemsRequest,
  PasteTextRequest,
  PrepareDragItemsRequest,
  PreparedDragItemsResult,
  BackendAction,
  BackendActionResult,
  BackendRunRequest,
  ConfigSecurityStatus,
  LinkPathRequest,
  PluginPanelRenderResult,
  PluginCommandRunResult,
  PluginCommandsSnapshot,
  PrepareOpenItemRequest,
  PreparedOpenItem,
  ProviderJobStart,
  ProviderJobStatus,
  ProviderRemote,
  ProviderWorkflow,
  ProviderConfigRequest,
  ProviderConfigStep,
  ProvidersSnapshot,
  PublicLinkActionResult,
  PublicLinkListResult,
  ProxySnapshot,
  RcloneConfigPaths,
  RemoteEditDraft,
  RemoteTestResult,
  RenameItemRequest,
  RenameItemsRequest,
  RenderPluginPanelRequest,
  RunPluginCommandRequest,
  SaveSettingsRequest,
  SaveRemoteRequest,
  SaveShortcutsRequest,
  SearchQueryRequest,
  SearchResult,
  SearchScanRequest,
  SearchStatus,
  SettingsSnapshot,
  ShortcutsSnapshot,
  TransferFilter,
  TransferPage,
  VerifyResult,
  VerifyStartRequest,
} from "./types";
import { hasTauriInternals } from "../shared/tauri";

function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!hasTauriInternals()) {
    const bridge = browserNativeBridgeInvoke<T>(command, args);
    if (bridge) return bridge;
    const fallback = browserSmokeFallback<T>(command, args);
    if (fallback) return fallback;
    return Promise.reject(new Error(`Native command "${command}" is only available in the Tauri app.`));
  }
  return tauriInvoke<T>(command, args);
}

function browserNativeBridgeInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> | null {
  const baseUrl = import.meta.env.VITE_MISTY_NATIVE_BRIDGE_URL?.trim();
  if (!baseUrl) return null;

  return fetch(`${baseUrl.replace(/\/+$/, "")}/invoke/${encodeURIComponent(command)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args ?? {}),
  }).then(async (response) => {
    const text = await response.text();
    const payload = text ? JSON.parse(text) as unknown : null;
    if (!response.ok) {
      const message = payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `Native bridge command "${command}" failed with ${response.status}.`;
      throw new Error(message);
    }
    return payload as T;
  });
}

function browserSmokeFallback<T>(command: string, args?: Record<string, unknown>): Promise<T> | null {
  switch (command) {
    case "app_snapshot":
      return Promise.resolve(browserAppSnapshot() as T);
    case "app_environment_snapshot":
      return Promise.resolve(browserAppSnapshot().environment as T);
    case "ai_status":
      return Promise.resolve({
        configured: false,
        provider: "mock",
        model: "mock",
        running: false,
        sessionId: null,
        error: "Browser smoke mode",
      } as T);
    case "ai_drain_events":
      return Promise.resolve([] as T);
    case "proxy_snapshot":
      return Promise.resolve({ proxyUrl: null, ready: false, statusCode: null, error: "Browser smoke mode" } as T);
    case "clipboard_snapshot":
      return Promise.resolve({ local: emptyClipboardPayload(), shared: emptyClipboardPayload() } as T);
    case "claude_status":
      return Promise.resolve({ installed: false, running: false, sessionId: null, error: "Browser smoke mode" } as T);
    case "claude_drain_events":
      return Promise.resolve([] as T);
    case "workspaces_snapshot":
      return Promise.resolve(browserWorkspaceDocument() as T);
    case "workspaces_save":
      return Promise.resolve((args?.document ?? browserWorkspaceDocument()) as T);
    case "explorer_list_directory":
      return Promise.resolve(browserDirectoryListing((args?.request as ListDirectoryRequest | undefined) ?? {}) as T);
    case "explorer_directory_size_snapshot": {
      const paths = Array.isArray(args?.paths) ? args.paths as string[] : [];
      return Promise.resolve(paths.map((path) => ({
        path,
        sizeBytes: null,
        status: "unknown",
        calculatedAtMs: null,
        error: null,
      })) as T);
    }
    case "explorer_calculate_directory_sizes": {
      const request = args?.request as DirectorySizeRequest | undefined;
      const paths = Array.isArray(request?.paths) ? request.paths : [];
      return Promise.resolve(paths.map((path) => ({
        path,
        sizeBytes: null,
        status: "unknown",
        calculatedAtMs: null,
        error: "Native directory size calculation is unavailable in browser smoke mode.",
      })) as T);
    }
    case "explorer_prepare_drag_items":
      return Promise.resolve({ items: [], skipped: [] } as T);
    case "devices_snapshot":
      return Promise.resolve({ devices: [] } as T);
    case "providers_snapshot":
    case "providers_refresh":
      return Promise.resolve(browserProvidersSnapshot() as T);
    case "transfers_snapshot":
      return Promise.resolve({ rows: [], totalCount: 0, dbPath: "" } as T);
    case "operation_queue_snapshot":
    case "operation_queue_redo":
      return Promise.resolve(browserOperationQueueSnapshot() as T);
    case "explorer_library_snapshot":
      return Promise.resolve({ recent: [], starred: [], trash: [], lastOpenedPath: null } as T);
    case "plugin_commands_snapshot":
      return Promise.resolve({ roots: [], commands: [], panels: [] } as T);
    case "plugin_command_run":
      return Promise.resolve({
        commandId: (args?.request as RunPluginCommandRequest | undefined)?.commandId ?? "",
        pluginId: "",
        pluginName: "",
        label: "",
        handled: false,
        targetRoute: "/hub/extensions",
        message: "Extension command execution is only available in the Tauri app.",
        notifications: [],
        runtimeStatus: "unavailable",
      } as T);
    case "settings_snapshot":
      return Promise.resolve(browserSettingsSnapshot() as T);
    case "settings_save":
      return Promise.resolve(browserSaveSettings((args?.request as SaveSettingsRequest | undefined)?.document ?? {}) as T);
    case "settings_launch_on_login_snapshot":
      return Promise.resolve({
        supported: false,
        enabled: false,
        target: "",
        detail: "Browser smoke mode",
      } as T);
    case "settings_apply_launch_on_login":
      return Promise.resolve({
        supported: false,
        enabled: Boolean(args?.enabled),
        target: "",
        detail: "Browser smoke mode",
      } as T);
    case "settings_open_with_associations":
      return Promise.resolve([] as T);
    case "settings_remove_open_with_association":
      return Promise.resolve(browserSettingsSnapshot() as T);
    case "shortcuts_snapshot":
      return Promise.resolve({ path: "", bindings: [] } as T);
    case "shortcuts_save":
      return Promise.resolve({ path: "", bindings: (args?.request as SaveShortcutsRequest | undefined)?.bindings ?? [] } as T);
    default:
      return null;
  }
}

const browserSmokeHome = "/Users/misty";
const browserSettingsStorageKey = "misty.browser-smoke.settings";

function browserAppSnapshot(): AppSnapshot {
  const mistyDir = `${browserSmokeHome}/.misty`;
  return {
    appName: "Misty",
    migrationStage: "Browser smoke mode",
    proxyUrl: null,
    proxyRuntime: {
      mode: "disabled",
      proxyUrl: null,
      ready: false,
      error: "Browser smoke mode",
    },
    environment: {
      homeDir: browserSmokeHome,
      mistyDir,
      configDir: `${mistyDir}/config`,
      dbDir: `${mistyDir}/db`,
      cacheDir: `${mistyDir}/cache`,
      tmpDir: `${mistyDir}/tmp`,
      assetsDir: `${mistyDir}/assets`,
      pluginsPublicDir: `${mistyDir}/plugins/public`,
      pluginsPrivateDir: `${mistyDir}/plugins/private`,
      settingsPath: `${mistyDir}/config/settings.json`,
      mistyConfigPath: `${mistyDir}/config/misty.json`,
      workspacesPath: `${mistyDir}/config/workspaces.json`,
      commandsPath: `${mistyDir}/config/commands.msy`,
      proxyUrl: null,
      serverUrl: null,
      grpcAddress: "",
      mountPath: ".misty/mnt",
      configExists: false,
      derivedEnv: {},
    },
  };
}

function browserSettingsSnapshot(): SettingsSnapshot {
  return {
    path: browserAppSnapshot().environment.settingsPath,
    document: browserSettingsDocument(),
  };
}

function browserSaveSettings(document: Record<string, unknown>): SettingsSnapshot {
  try {
    window.localStorage.setItem(browserSettingsStorageKey, JSON.stringify(document));
  } catch {
    // Smoke mode can still run without writable localStorage.
  }
  return {
    path: browserAppSnapshot().environment.settingsPath,
    document,
  };
}

function browserSettingsDocument(): Record<string, unknown> {
  try {
    const raw = window.localStorage.getItem(browserSettingsStorageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    }
  } catch {
    // Ignore malformed smoke-mode data.
  }
  return {};
}

function emptyClipboardPayload(): ClipboardPayload {
  return {
    kind: "empty",
    origin: "local_misty",
    payload_id: "",
    source_device_id: "",
    source_device_name: "",
    revision: 0,
    created_unix_ms: 0,
    text: "",
    html: "",
    file_refs: [],
    images: [],
  };
}

function browserWorkspaceDocument() {
  return {
    schema_version: 1,
    active_workspace_id: "workspace_0",
    next_workspace_idx: 1,
    workspaces: [],
  };
}

function browserProvidersSnapshot(): ProvidersSnapshot {
  return {
    health: {
      ready: false,
      port: null,
      version: null,
      uptimeSeconds: 0,
      connectedProviders: 0,
      availableProviders: 0,
      error: "Browser smoke mode",
    },
    remotes: [],
    workflows: defaultProviderWorkflows(),
    loading: false,
    error: null,
  };
}

function defaultProviderWorkflows(): ProviderWorkflow[] {
  return [
    {
      type: "drive",
      name: "Google Drive",
      description: "Connect a Google Drive remote with browser sign-in.",
      options: [
        {
          name: "scope",
          label: "Scope",
          help: "Access scope requested from Google Drive.",
          defaultValue: "drive",
          required: true,
          password: false,
          choices: [{ value: "drive", help: "Full Google Drive access" }],
        },
      ],
    },
    {
      type: "dropbox",
      name: "Dropbox",
      description: "Connect a Dropbox remote with browser sign-in.",
      options: [],
    },
    {
      type: "onedrive",
      name: "OneDrive",
      description: "Connect a Microsoft OneDrive remote with browser sign-in.",
      options: [],
    },
  ];
}

function browserOperationQueueSnapshot(): OperationQueueSnapshot {
  return {
    operations: [],
    batches: [],
    conflictDialog: {
      open: false,
      operationId: 0,
      batchId: 0,
      applyToBatch: false,
      supportsReplace: true,
      supportsKeepBoth: true,
      selectedPolicy: "ask",
      title: "",
      sourceLabel: "",
      targetLabel: "",
    },
    activeCount: 0,
    maxConcurrent: 4,
    redoAvailable: false,
  };
}

function browserDirectoryListing(request: ListDirectoryRequest): DirectoryListing {
  const requestedPath = normalizeBrowserPath(request.path || browserSmokeHome);
  const entries = browserEntriesForPath(requestedPath);
  return {
    path: requestedPath,
    parentPath: requestedPath === "/" ? null : parentBrowserPath(requestedPath),
    location: { kind: "local", providerType: null, remoteName: null, remotePath: null },
    entries,
    totalCount: entries.length,
    hiddenCount: entries.filter((entry) => entry.hidden).length,
  };
}

function browserEntriesForPath(path: string) {
  const now = Date.now();
  const folder = (name: string, offset: number) => browserFileEntry(path, name, "folder", null, now - offset);
  const file = (name: string, sizeBytes: number, offset: number) => browserFileEntry(path, name, "file", sizeBytes, now - offset);
  if (path === "/" || path === "/Users") {
    return [folder("misty", 86_400_000)];
  }
  if (path === browserSmokeHome) {
    return [
      folder("Desktop", 3_600_000),
      folder("Documents", 7_200_000),
      folder("Downloads", 10_800_000),
      folder("Projects", 14_400_000),
      file("migration-notes.md", 3_224, 18_000_000),
      file("screenshot.png", 248_120, 22_000_000),
    ];
  }
  return [
    file("example.txt", 1_024, 3_600_000),
    folder("Nested Folder", 7_200_000),
  ];
}

function browserFileEntry(
  parentPath: string,
  name: string,
  kind: "folder" | "file",
  sizeBytes: number | null,
  modifiedMs: number,
): FileEntry {
  const path = `${parentPath.replace(/\/+$/, "")}/${name}`.replace(/^$/, "/");
  const extension = kind === "file" && name.includes(".") ? name.split(".").pop() || "" : "";
  return {
    id: path,
    name,
    path,
    extension,
    mimeType: extension === "png" ? "image/png" : extension === "md" ? "text/markdown" : null,
    remoteModified: null,
    kind,
    sizeBytes,
    modifiedMs,
    createdMs: modifiedMs,
    readonly: false,
    hidden: name.startsWith("."),
    isDeleted: false,
    location: { kind: "local", providerType: null, remoteName: null, remotePath: null },
  };
}

function normalizeBrowserPath(path: string): string {
  const trimmed = path.trim() || browserSmokeHome;
  return trimmed.startsWith("/") ? trimmed.replace(/\/+$/, "") || "/" : `${browserSmokeHome}/${trimmed}`;
}

function parentBrowserPath(path: string): string | null {
  const normalized = normalizeBrowserPath(path);
  if (normalized === "/") return null;
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? "/" : normalized.slice(0, index);
}

export function appSnapshot(): Promise<AppSnapshot> {
  return invoke("app_snapshot");
}

export function appEnvironmentSnapshot(): Promise<AppEnvironmentSnapshot> {
  return invoke("app_environment_snapshot");
}

export function proxySnapshot(): Promise<ProxySnapshot> {
  return invoke("proxy_snapshot");
}

export function aiStatus(): Promise<AiStatus> {
  return invoke("ai_status");
}

export function aiSendMessage(request: AiSendRequest): Promise<AiStatus> {
  return invoke("ai_send_message", { request });
}

export function aiDrainEvents(): Promise<AiStreamEvent[]> {
  return invoke("ai_drain_events");
}

export function aiAbort(): Promise<AiStatus> {
  return invoke("ai_abort");
}

export function claudeStatus(): Promise<ClaudeStatus> {
  return invoke("claude_status");
}

export function claudeSendMessage(request: ClaudeSendRequest): Promise<ClaudeStatus> {
  return invoke("claude_send_message", { request });
}

export function claudeDrainEvents(): Promise<ClaudeStreamEvent[]> {
  return invoke("claude_drain_events");
}

export function claudeAbort(): Promise<ClaudeStatus> {
  return invoke("claude_abort");
}

export function clipboardSnapshot(): Promise<ClipboardSnapshot> {
  return invoke("clipboard_snapshot");
}

export function clipboardSetLocal(payload: ClipboardPayload): Promise<ClipboardPayload> {
  return invoke("clipboard_set_local", { payload });
}

export function clipboardPublishShared(): Promise<boolean> {
  return invoke("clipboard_publish_shared");
}

export function clipboardPublishImageBytes(request: {
  bytes: number[];
  width: number;
  height: number;
  mimeType?: string;
}): Promise<boolean> {
  return invoke("clipboard_publish_image_bytes", request);
}

export function clipboardApplyShared(): Promise<ClipboardPayload> {
  return invoke("clipboard_apply_shared");
}

export function clipboardSharedImageBytes(blobId: string): Promise<number[]> {
  return invoke("clipboard_shared_image_bytes", { blobId });
}

export function clipboardNativeFileRefs(): Promise<PasteItem[]> {
  return invoke("clipboard_native_file_refs");
}

export function clipboardWriteFileRefs(items: PasteItem[]): Promise<boolean> {
  return invoke("clipboard_write_file_refs", { items });
}

export function devicesSnapshot(): Promise<DeviceSnapshot> {
  return invoke("devices_snapshot");
}

export function explorerListDirectory(request: ListDirectoryRequest): Promise<DirectoryListing> {
  return invoke("explorer_list_directory", { request });
}

export function explorerDirectorySizeSnapshot(paths: string[]): Promise<DirectorySizeRecord[]> {
  return invoke("explorer_directory_size_snapshot", { paths });
}

export function explorerCalculateDirectorySizes(request: DirectorySizeRequest): Promise<DirectorySizeRecord[]> {
  return invoke("explorer_calculate_directory_sizes", { request });
}

export function searchInit(): Promise<SearchStatus> {
  return invoke("search_init");
}

export function searchGetStatus(): Promise<SearchStatus> {
  return invoke("search_get_status");
}

export function searchStartScan(request: SearchScanRequest): Promise<SearchStatus> {
  return invoke("search_start_scan", { request });
}

export function searchCancelScan(): Promise<SearchStatus> {
  return invoke("search_cancel_scan");
}

export function searchQuery(request: SearchQueryRequest): Promise<SearchResult[]> {
  return invoke("search_query", { request });
}

export function explorerCreateItem(request: CreateItemRequest): Promise<ExplorerOperationResult> {
  return invoke("explorer_create_item", { request });
}

export function explorerRenameItem(request: RenameItemRequest): Promise<ExplorerOperationResult> {
  return invoke("explorer_rename_item", { request });
}

export function explorerDeleteItems(request: DeleteItemsRequest): Promise<ExplorerOperationResult> {
  return invoke("explorer_delete_items", { request });
}

export function explorerPasteItems(request: PasteItemsRequest): Promise<ExplorerOperationResult> {
  return invoke("explorer_paste_items", { request });
}

export function explorerPrepareOpenItem(request: PrepareOpenItemRequest): Promise<PreparedOpenItem> {
  return invoke("explorer_prepare_open_item", { request });
}

export function explorerPrepareDragItems(request: PrepareDragItemsRequest): Promise<PreparedDragItemsResult> {
  return invoke("explorer_prepare_drag_items", { request });
}

export function explorerPreviewItem(path: string): Promise<ExplorerPreviewPayload> {
  return invoke("explorer_preview_item", { path });
}

export function explorerPathIsDirectory(path: string): Promise<boolean> {
  return invoke("explorer_path_is_directory", { path });
}

export function explorerPathExists(path: string): Promise<boolean> {
  return invoke("explorer_path_exists", { path });
}

export function explorerLibrarySnapshot(): Promise<ExplorerLibrarySnapshot> {
  return invoke("explorer_library_snapshot");
}

export function explorerLibraryRecordRecent(item: ExplorerLibraryItem): Promise<ExplorerLibrarySnapshot> {
  return invoke("explorer_library_record_recent", { request: { item } });
}

export function explorerLibraryRecordLastOpened(path: string): Promise<ExplorerLibrarySnapshot> {
  return invoke("explorer_library_record_last_opened", { request: { path } });
}

export function explorerLibrarySetTags(item: ExplorerLibraryItem, tags: string[]): Promise<ExplorerLibrarySnapshot> {
  return invoke("explorer_library_set_tags", { request: { item, tags } });
}

export function explorerOpenWith(applicationPath: string, filePath: string): Promise<void> {
  return invoke("explorer_open_with", { applicationPath, filePath });
}

export function explorerOpenPath(filePath: string): Promise<void> {
  return invoke("explorer_open_path", { filePath });
}

export function openTerminalAtPath(path: string): Promise<void> {
  return invoke("open_terminal_at_path", { path });
}

export function explorerOpenAssociation(filePath: string): Promise<string | null> {
  return invoke("explorer_open_association", { filePath });
}

export function explorerSetOpenAssociation(filePath: string, applicationPath: string): Promise<SettingsSnapshot> {
  return invoke("explorer_set_open_association", { filePath, applicationPath });
}

export function explorerQueuePasteItems(request: PasteItemsRequest): Promise<OperationQueueSnapshot> {
  return invoke("explorer_queue_paste_items", { request });
}

export function explorerQueuePasteText(request: PasteTextRequest): Promise<OperationQueueSnapshot> {
  return invoke("explorer_queue_paste_text", { request });
}

export function explorerQueuePasteBlob(request: PasteBlobRequest): Promise<OperationQueueSnapshot> {
  return invoke("explorer_queue_paste_blob", { request });
}

export function explorerQueueCreateItem(request: CreateItemRequest): Promise<OperationQueueSnapshot> {
  return invoke("explorer_queue_create_item", { request });
}

export function explorerQueueRenameItem(request: RenameItemRequest): Promise<OperationQueueSnapshot> {
  return invoke("explorer_queue_rename_item", { request });
}

export function explorerQueueRenameItems(request: RenameItemsRequest): Promise<OperationQueueSnapshot> {
  return invoke("explorer_queue_rename_items", { request });
}

export function explorerQueueDeleteItems(request: DeleteItemsRequest): Promise<OperationQueueSnapshot> {
  return invoke("explorer_queue_delete_items", { request });
}

export function workspacesSnapshot(): Promise<NativeWorkspaceDocument> {
  return invoke("workspaces_snapshot");
}

export function workspacesSave(document: NativeWorkspaceDocument): Promise<NativeWorkspaceDocument> {
  return invoke("workspaces_save", { document });
}

export function settingsSnapshot(): Promise<SettingsSnapshot> {
  return invoke("settings_snapshot");
}

export function settingsSave(request: SaveSettingsRequest): Promise<SettingsSnapshot> {
  return invoke("settings_save", { request });
}

export function settingsLaunchOnLoginSnapshot(): Promise<LaunchOnLoginSnapshot> {
  return invoke("settings_launch_on_login_snapshot");
}

export function settingsApplyLaunchOnLogin(enabled: boolean): Promise<LaunchOnLoginSnapshot> {
  return invoke("settings_apply_launch_on_login", { enabled });
}

export function settingsOpenWithAssociations(): Promise<OpenWithAssociation[]> {
  return invoke("settings_open_with_associations");
}

export function settingsRemoveOpenWithAssociation(key: string): Promise<SettingsSnapshot> {
  return invoke("settings_remove_open_with_association", { key });
}

export function shortcutsSnapshot(): Promise<ShortcutsSnapshot> {
  return invoke("shortcuts_snapshot");
}

export function shortcutsSave(request: SaveShortcutsRequest): Promise<ShortcutsSnapshot> {
  return invoke("shortcuts_save", { request });
}

export function pluginCommandsSnapshot(): Promise<PluginCommandsSnapshot> {
  return invoke("plugin_commands_snapshot");
}

export function pluginCommandRun(request: RunPluginCommandRequest): Promise<PluginCommandRunResult> {
  return invoke("plugin_command_run", { request });
}

export function pluginPanelRender(request: RenderPluginPanelRequest): Promise<PluginPanelRenderResult> {
  return invoke("plugin_panel_render", { request });
}

export function openExternalUrl(url: string): Promise<void> {
  return invoke("open_external_url", { url });
}

export function providersSnapshot(): Promise<ProvidersSnapshot> {
  return invoke("providers_snapshot");
}

export function providersRefresh(): Promise<ProvidersSnapshot> {
  return invoke("providers_refresh");
}

export function providersSelectRemote(name: string): Promise<RemoteEditDraft> {
  return invoke("providers_select_remote", { name });
}

export function providersSaveRemote(request: SaveRemoteRequest): Promise<RemoteEditDraft> {
  return invoke("providers_save_remote", { request });
}

export function providersTestRemote(name: string): Promise<RemoteTestResult> {
  return invoke("providers_test_remote", { name });
}

export function providersConfigPaths(): Promise<RcloneConfigPaths> {
  return invoke("providers_config_paths");
}

export function providersConfigureRemote(request: ProviderConfigRequest): Promise<ProviderConfigStep> {
  return invoke("providers_configure_remote", { request });
}

export function providersVerifyStart(request: VerifyStartRequest): Promise<ProviderJobStart> {
  return invoke("providers_verify_start", { request });
}

export function providersJobStatus(jobId: string): Promise<ProviderJobStatus> {
  return invoke("providers_job_status", { jobId });
}

export function providersJobCancel(jobId: string): Promise<unknown> {
  return invoke("providers_job_cancel", { jobId });
}

export function providersVerifyResult(jobId: string): Promise<VerifyResult> {
  return invoke("providers_verify_result", { jobId });
}

export function providersPublicLinks(request: LinkPathRequest): Promise<PublicLinkListResult> {
  return invoke("providers_public_links", { request });
}

export function providersCreatePublicLink(request: LinkPathRequest): Promise<PublicLinkActionResult> {
  return invoke("providers_create_public_link", { request });
}

export function providersRevokePublicLink(request: LinkPathRequest): Promise<PublicLinkActionResult> {
  return invoke("providers_revoke_public_link", { request });
}

export function providersBackendActions(remote: string): Promise<BackendAction[]> {
  return invoke("providers_backend_actions", { remote });
}

export function providersRunBackendAction(request: BackendRunRequest): Promise<BackendActionResult> {
  return invoke("providers_run_backend_action", { request });
}

export function providersConfigSecurity(): Promise<ConfigSecurityStatus> {
  return invoke("providers_config_security");
}

export function providersHardenConfig(): Promise<ConfigSecurityStatus> {
  return invoke("providers_harden_config");
}

export function providersRepairConfigSecurity(password: string): Promise<ConfigSecurityStatus> {
  return invoke("providers_repair_config_security", { password });
}

export function providersDisconnectRemote(name: string): Promise<ProvidersSnapshot> {
  return invoke("providers_disconnect_remote", { name });
}

export function transfersSnapshot(filter: TransferFilter = {}): Promise<TransferPage> {
  return invoke("transfers_snapshot", { filter });
}

export function transfersDeleteSelected(ids: number[]): Promise<void> {
  return invoke("transfers_delete_selected", { ids });
}

export function transfersDeleteAll(): Promise<void> {
  return invoke("transfers_delete_all");
}

export function operationQueueSnapshot(): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_snapshot");
}

export function operationQueueCancel(operationId: number): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_cancel", { operationId });
}

export function operationQueueCancelBatch(batchId: number): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_cancel_batch", { batchId });
}

export function operationQueueRetry(operationId: number): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_retry", { operationId });
}

export function operationQueueUndo(undoTokenId: number): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_undo", { undoTokenId });
}

export function operationQueueRedo(): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_redo");
}

export function operationQueueResolveConflict(
  operationId: number,
  policy: OperationConflictPolicy,
  applyToBatch: boolean,
): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_resolve_conflict", { operationId, policy, applyToBatch });
}

export function operationQueueClearTerminal(): Promise<OperationQueueSnapshot> {
  return invoke("operation_queue_clear_terminal");
}

export function fileSyncPairsSnapshot(): Promise<FileSyncPair[]> {
  return invoke("file_sync_pairs_snapshot");
}

export function fileSyncPairSave(pair: FileSyncPair): Promise<FileSyncPair> {
  return invoke("file_sync_pair_save", { pair });
}

export function fileSyncPairRemove(pairId: number): Promise<void> {
  return invoke("file_sync_pair_remove", { pairId });
}

export function fileSyncCompare(request: FileSyncCompareRequest): Promise<FileSyncCompareResult> {
  return invoke("file_sync_compare", { request });
}

export function fileSyncApply(request: FileSyncApplyRequest): Promise<FileSyncApplyResult> {
  return invoke("file_sync_apply", { request });
}

export function remoteDisplayName(remote: ProviderRemote): string {
  return remote.name || "(unnamed remote)";
}
