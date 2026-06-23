import {
  AppWindow,
  Clipboard,
  Copy,
  Download,
  FilePlus,
  Eye,
  FolderPlus,
  GitCompareArrows,
  MessageSquare,
  PanelLeft,
  PanelRight,
  Pencil,
  Pin,
  RefreshCcw,
  Scissors,
  Trash2,
  X,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { readText, writeHtml, writeImage, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { MultiPanelWorkspace } from "../../shared/multipanel/MultiPanelWorkspace";
import { useAppStore } from "../../app/useAppStore";
import {
  clipboardApplyShared,
  clipboardPublishImageBytes,
  clipboardPublishShared,
  clipboardSetLocal,
  clipboardSharedImageBytes,
  clipboardWriteFileRefs,
  devicesSnapshot,
  explorerPrepareDragItems,
  operationQueueRedo,
  operationQueueUndo,
  pluginCommandRun,
  pluginCommandsSnapshot,
  shortcutsSnapshot,
  transfersSnapshot,
} from "../../api/misty";
import { ExplorerPane } from "./components/ExplorerPane";
import { ExplorerSidebar } from "./components/ExplorerSidebar";
import { ExplorerToolbar } from "./components/ExplorerToolbar";
import type { ExplorerLocationResult } from "./components/ExplorerToolbar";
import { FileInspector } from "./components/FileInspector";
import {
  explorerWorkspaceNeedsSave,
  scheduleExplorerWorkspaceSave,
  selectedEntryForPane,
  selectedPathsForPane,
  useExplorerStore,
} from "./state/useExplorerStore";
import type { ExplorerInlineEditState, ExplorerNotification } from "./state/useExplorerStore";
import { useClaudeSessionStore } from "./state/useClaudeSessionStore";
import { useMultiPanelStore } from "../../shared/multipanel/useMultiPanelStore";
import { useProvidersStore } from "../providers/useProvidersStore";
import type {
  ClipboardPayload,
  ExplorerLibrarySnapshot,
  FileSyncEndpoint,
  FileSyncCompareSide,
  FileSyncPlannedAction,
  MountedDevice,
  PluginCommandEntry,
  ProviderRemote,
  TransferRecord,
} from "../../api/types";
import type { MultiPanelTab } from "../../shared/multipanel/types";
import { useFileSyncStore } from "./state/useFileSyncStore";
import { useOperationQueueStore } from "../transfers/useOperationQueueStore";
import { useTransfersStore } from "../transfers/useTransfersStore";
import { shortcutMapFromBindings, shortcutMatchesEvent } from "../../shared/shortcuts";
import type { ShortcutMap } from "../../shared/shortcuts";
import { selectAdvancedPreferences, selectGeneralPreferences, selectShortcutPreferences, useSettingsStore } from "../settings/useSettingsStore";
import { errorText } from "../../shared/format";
import { pluginCatalogChangedEvent } from "../plugins/pluginEvents";
import { publishPluginNotifications } from "../plugins/pluginNotifications";
import { clipboardImagePng } from "./utils/clipboardImage";
import { formatBytes } from "./utils/fileFormat";

const minSidebarWidth = 212;
const maxSidebarWidth = 380;
const minPreviewWidth = 240;
const maxPreviewWidth = 420;
const minClaudePanelWidth = 280;
const maxClaudePanelWidth = 600;
const folderHoverOpenDelayMs = 3000;
const transferRefreshPollMs = 12000;
const explorerSearchFocusEvent = "misty:explorer-search-focus";
const emptyPinnedPaths: string[] = [];
const emptyProviderRemotes: ProviderRemote[] = [];
const emptyPluginCommands: PluginCommandEntry[] = [];
const emptyMountedDevices: MountedDevice[] = [];
const emptyInspectorTags: string[] = [];

const executableShortcutCommands = [
  "app.open_settings",
  "app.toggle_transfers",
  "app.toggle_plugin_launcher",
  "clipboard.publish_shared",
  "clipboard.apply_shared",
  "search.toggle",
  "explorer.open_palette",
  "explorer.copy",
  "explorer.cut",
  "explorer.paste",
  "explorer.undo",
  "explorer.redo",
  "explorer.delete",
  "explorer.download",
  "explorer.rename",
  "explorer.refresh",
  "explorer.new_tab",
  "explorer.restore_tab",
  "explorer.close_pane",
  "explorer.restore_pane",
  "explorer.split_vertical",
  "explorer.split_horizontal",
  "explorer.toggle_chat",
  "explorer.toggle_claude",
  "explorer.next_workspace",
  "explorer.tab_1",
  "explorer.tab_2",
  "explorer.tab_3",
  "explorer.tab_4",
  "explorer.tab_5",
  "explorer.tab_6",
  "explorer.tab_7",
  "explorer.tab_8",
  "explorer.tab_9",
] as const;
const defaultMacExplorerShortcuts: ShortcutMap = {
  "app.open_settings": "Cmd+Comma",
  "app.toggle_transfers": "Cmd+Shift+Y",
  "app.toggle_plugin_launcher": "Cmd+Shift+P",
  "clipboard.publish_shared": "Cmd+Alt+C",
  "clipboard.apply_shared": "Cmd+Alt+V",
  "search.toggle": "Cmd+K",
  "explorer.open_palette": "Cmd+P",
  "explorer.copy": "Cmd+C",
  "explorer.cut": "Cmd+X",
  "explorer.paste": "Cmd+V",
  "explorer.undo": "Cmd+Z",
  "explorer.redo": "Cmd+Shift+Z",
  "explorer.delete": "Delete",
  "explorer.rename": "F2",
  "explorer.refresh": "Cmd+R",
  "explorer.toggle_chat": "Cmd+J",
  "explorer.toggle_claude": "Cmd+Shift+A",
  "explorer.next_workspace": "Cmd+Shift+Grave",
  "explorer.new_tab": "Cmd+T",
  "explorer.restore_tab": "Cmd+Shift+T",
  "explorer.close_pane": "Cmd+W",
  "explorer.restore_pane": "Cmd+Ctrl+Backslash",
  "explorer.split_vertical": "Cmd+Backslash",
  "explorer.split_horizontal": "Cmd+Shift+Backslash",
  "explorer.tab_1": "Cmd+1",
  "explorer.tab_2": "Cmd+2",
  "explorer.tab_3": "Cmd+3",
  "explorer.tab_4": "Cmd+4",
  "explorer.tab_5": "Cmd+5",
  "explorer.tab_6": "Cmd+6",
  "explorer.tab_7": "Cmd+7",
  "explorer.tab_8": "Cmd+8",
  "explorer.tab_9": "Cmd+9",
};
const defaultNonMacExplorerShortcuts: ShortcutMap = {
  "app.open_settings": "Ctrl+Comma",
  "app.toggle_transfers": "Ctrl+Shift+Y",
  "app.toggle_plugin_launcher": "Ctrl+Shift+P",
  "clipboard.publish_shared": "Ctrl+Alt+C",
  "clipboard.apply_shared": "Ctrl+Alt+V",
  "search.toggle": "Ctrl+K",
  "explorer.open_palette": "Ctrl+P",
  "explorer.copy": "Ctrl+C",
  "explorer.cut": "Ctrl+X",
  "explorer.paste": "Ctrl+V",
  "explorer.undo": "Ctrl+Z",
  "explorer.redo": "Ctrl+Shift+Z",
  "explorer.delete": "Delete",
  "explorer.rename": "F2",
  "explorer.refresh": "Ctrl+R",
  "explorer.toggle_chat": "Ctrl+J",
  "explorer.toggle_claude": "Ctrl+Shift+A",
  "explorer.next_workspace": "Ctrl+Shift+Grave",
  "explorer.new_tab": "Ctrl+T",
  "explorer.restore_tab": "Ctrl+Shift+T",
  "explorer.close_pane": "Ctrl+W",
  "explorer.restore_pane": "Ctrl+Ctrl+Backslash",
  "explorer.split_vertical": "Ctrl+Backslash",
  "explorer.split_horizontal": "Ctrl+Shift+Backslash",
  "explorer.tab_1": "Ctrl+1",
  "explorer.tab_2": "Ctrl+2",
  "explorer.tab_3": "Ctrl+3",
  "explorer.tab_4": "Ctrl+4",
  "explorer.tab_5": "Ctrl+5",
  "explorer.tab_6": "Ctrl+6",
  "explorer.tab_7": "Ctrl+7",
  "explorer.tab_8": "Ctrl+8",
  "explorer.tab_9": "Ctrl+9",
};

const vscodeExplorerShortcutOverrides: ShortcutMap = {
  "explorer.open_palette": "Primary+Shift+P",
  "search.toggle": "Primary+P",
};

const finderExplorerShortcutOverrides: ShortcutMap = {
  "explorer.open_palette": "Primary+Shift+P",
  "search.toggle": "Primary+F",
  "explorer.delete": "Primary+Backspace",
  "explorer.rename": "Enter",
};

type ResizeTarget = "sidebar" | "preview" | "claude" | null;
type ExternalDropTarget = {
  paneId: string;
  destination: string;
  kind: "directory" | "folder" | "unknown";
};

export const ExplorerWorkspace = memo(function ExplorerWorkspace() {
  const navigate = useNavigate();
  const app = useAppStore((state) => state.app);
  const {
    initialize,
    sidebarVisible,
    previewVisible,
    sidebarWidth,
    previewWidth,
    pinnedPaths,
    library,
    workspaceEntries,
    activeWorkspaceId,
    activeWorkspaceTitle,
    selectWorkspace,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
    operationError,
    inlineEdit,
    notifications,
    pushNotification,
    dismissNotification,
    chatOverlayOpen,
    claudePanelOpen,
    claudePanelWidth,
  } = useExplorerStore(useShallow((state) => ({
    initialize: state.initialize,
    sidebarVisible: state.sidebarVisible,
    previewVisible: state.previewVisible,
    sidebarWidth: state.sidebarWidth,
    previewWidth: state.previewWidth,
    pinnedPaths: state.pinnedPaths,
    library: state.library,
    workspaceEntries: state.workspaceEntries,
    activeWorkspaceId: state.activeWorkspaceId,
    activeWorkspaceTitle: state.activeWorkspaceTitle,
    selectWorkspace: state.selectWorkspace,
    createWorkspace: state.createWorkspace,
    renameWorkspace: state.renameWorkspace,
    deleteWorkspace: state.deleteWorkspace,
    operationError: state.operationError,
    inlineEdit: state.inlineEdit,
    notifications: state.notifications,
    pushNotification: state.pushNotification,
    dismissNotification: state.dismissNotification,
    chatOverlayOpen: state.chatOverlayOpen,
    claudePanelOpen: state.claudePanelOpen,
    claudePanelWidth: state.claudePanelWidth,
  })));
  const { providersLoading, sidebarRemotes } = useProvidersStore(useShallow((state) => ({
    providersLoading: state.loading,
    sidebarRemotes: state.providers?.remotes ?? emptyProviderRemotes,
  })));
  const { activePaneId, workspacePathSignature } = useMultiPanelStore(useShallow((state) => ({
    activePaneId: state.activePaneId,
    workspacePathSignature: state.tabs
      .flatMap((tab) => [tab.path, ...tab.panes.map((pane) => pane.path)])
      .join("\n"),
  })));
  const workspaceRef = useRef<HTMLElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const pendingResizeXRef = useRef(0);
  const resizeTargetRef = useRef<ResizeTarget>(null);
  const pendingResizeSaveRef = useRef(false);
  const externalHoverTimerRef = useRef<number | null>(null);
  const externalHoverTargetRef = useRef<string | null>(null);
  const transferRefreshInFlightRef = useRef(false);
  const deviceRefreshInFlightRef = useRef(false);
  const deviceRefreshMountedRef = useRef(true);
  const lastOperationErrorToastRef = useRef<string | null>(null);
  const [resizeTarget, setResizeTarget] = useState<ResizeTarget>(null);
  const [pluginCommands, setPluginCommands] = useState<PluginCommandEntry[]>(emptyPluginCommands);
  const pluginCommandsRef = useRef<PluginCommandEntry[]>(emptyPluginCommands);
  const [mountedDevices, setMountedDevices] = useState<MountedDevice[]>(emptyMountedDevices);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const { preferredWorkspaceRoot, settingsLoaded, settingsMountPath } = useSettingsStore(useShallow((state) => ({
    preferredWorkspaceRoot: selectGeneralPreferences(state.settings?.document).preferredWorkspaceRoot,
    settingsMountPath: selectAdvancedPreferences(state.settings?.document).mountPath,
    settingsLoaded: state.loaded,
  })));
  const shortcutPreferences = useSettingsStore(useShallow((state) =>
    selectShortcutPreferences(state.settings?.document),
  ));
  const environmentHomePath = app?.environment.homeDir ?? "/";
  const homePath = resolvePreferredWorkspaceRoot(preferredWorkspaceRoot, environmentHomePath);
  const mountRoot = resolveMountRoot(homePath, settingsMountPath || app?.environment.mountPath || ".misty/mnt");
  const activePath = useExplorerStore((state) => state.panes[activePaneId]?.listing?.path ?? homePath);
  const activePaneIdRef = useRef(activePaneId);
  const activePathRef = useRef(activePath);
  const shortcutMapRef = useRef<ShortcutMap>(defaultExplorerShortcutMap(shortcutPreferences.keymapIndex));
  const executableCommandIdsRef = useRef<readonly string[]>(executableShortcutCommands);
  const workspacePaths = useMemo(
    () => workspacePathSignature.split("\n").filter(Boolean),
    [workspacePathSignature],
  );
  const locationResults = useMemo(
    () => buildExplorerLocationResults(homePath, mountRoot, pinnedPaths, sidebarRemotes, library, workspacePaths),
    [homePath, library, mountRoot, pinnedPaths, sidebarRemotes, workspacePaths],
  );
  const workspaceStyle = useMemo(() => ({
    "--explorer-sidebar-width": `${sidebarWidth}px`,
    "--preview-width": `${previewWidth}px`,
    "--claude-panel-width": `${claudePanelWidth}px`,
  } as CSSProperties), [claudePanelWidth, previewWidth, sidebarWidth]);

  useEffect(() => {
    activePaneIdRef.current = activePaneId;
    activePathRef.current = activePath;
  }, [activePaneId, activePath]);

  useEffect(() => {
    if (app?.environment.homeDir && settingsLoaded) {
      void initialize(homePath);
    }
  }, [app?.environment.homeDir, homePath, initialize, settingsLoaded]);

  useEffect(() => {
    if (!operationError) {
      lastOperationErrorToastRef.current = null;
      return;
    }
    if (lastOperationErrorToastRef.current === operationError) return;
    lastOperationErrorToastRef.current = operationError;
    pushNotification(operationError, "error", 4500);
  }, [operationError, pushNotification]);

  useEffect(() => {
    const unsubscribeExplorer = useExplorerStore.subscribe((state, previous) => {
      if (!explorerWorkspaceNeedsSave(state, previous)) return;
      if (resizeTargetRef.current) {
        pendingResizeSaveRef.current = true;
      } else {
        scheduleExplorerWorkspaceSave();
      }
    });
    const unsubscribeMulti = useMultiPanelStore.subscribe((state, previous) => {
      if (multiPanelWorkspaceNeedsSave(state, previous)) scheduleExplorerWorkspaceSave();
    });
    return () => {
      unsubscribeExplorer();
      unsubscribeMulti();
    };
  }, []);

  useEffect(() => {
    resizeTargetRef.current = resizeTarget;
    if (!resizeTarget && pendingResizeSaveRef.current) {
      pendingResizeSaveRef.current = false;
      scheduleExplorerWorkspaceSave();
    }
  }, [resizeTarget]);

  useEffect(() => {
    let disposed = false;
    const loadCommandMetadata = async () => {
      try {
        const [shortcutSnapshot, pluginSnapshot] = await Promise.all([
          shortcutsSnapshot(),
          pluginCommandsSnapshot(),
        ]);
        if (!disposed) {
          const fallbackShortcuts = defaultExplorerShortcutMap(shortcutPreferences.keymapIndex);
          const shortcutMap = shortcutPreferences.customShortcutsEnabled
            ? shortcutMapFromBindings(shortcutSnapshot.bindings, fallbackShortcuts)
            : fallbackShortcuts;
          for (const command of pluginSnapshot.commands) {
            if (command.defaultShortcut && !shortcutMap[command.id]) {
              shortcutMap[command.id] = command.defaultShortcut;
            }
          }
          shortcutMapRef.current = shortcutMap;
          executableCommandIdsRef.current = [
            ...executableShortcutCommands,
            ...pluginSnapshot.commands.map((command) => command.id),
          ];
          pluginCommandsRef.current = pluginSnapshot.commands;
          setPluginCommands((current) => pluginCommandsEqual(current, pluginSnapshot.commands) ? current : pluginSnapshot.commands);
        }
      } catch {
        if (!disposed) {
          shortcutMapRef.current = defaultExplorerShortcutMap(shortcutPreferences.keymapIndex);
          executableCommandIdsRef.current = executableShortcutCommands;
          pluginCommandsRef.current = emptyPluginCommands;
          setPluginCommands((current) => current.length === 0 ? current : emptyPluginCommands);
        }
      }
    };
    void loadCommandMetadata();
    window.addEventListener("focus", loadCommandMetadata);
    window.addEventListener(pluginCatalogChangedEvent, loadCommandMetadata);
    return () => {
      disposed = true;
      window.removeEventListener("focus", loadCommandMetadata);
      window.removeEventListener(pluginCatalogChangedEvent, loadCommandMetadata);
    };
  }, [shortcutPreferences.customShortcutsEnabled, shortcutPreferences.keymapIndex]);

  const refreshDevices = useCallback(async () => {
    if (deviceRefreshInFlightRef.current) return;
    deviceRefreshInFlightRef.current = true;
    if (deviceRefreshMountedRef.current) setDevicesLoading(true);
    try {
      const snapshot = await devicesSnapshot();
      if (deviceRefreshMountedRef.current) {
        setMountedDevices((current) => mountedDevicesEqual(current, snapshot.devices) ? current : snapshot.devices);
      }
    } catch {
      if (deviceRefreshMountedRef.current) {
        setMountedDevices((current) => current.length === 0 ? current : emptyMountedDevices);
      }
    } finally {
      deviceRefreshInFlightRef.current = false;
      if (deviceRefreshMountedRef.current) setDevicesLoading(false);
    }
  }, []);

  useEffect(() => {
    deviceRefreshMountedRef.current = true;
    void refreshDevices();
    window.addEventListener("focus", refreshDevices);
    return () => {
      deviceRefreshMountedRef.current = false;
      window.removeEventListener("focus", refreshDevices);
    };
  }, [refreshDevices]);

  useEffect(() => {
    const poll = async () => {
      if (document.hidden || transferRefreshInFlightRef.current || !useExplorerStore.getState().initialized) return;
      transferRefreshInFlightRef.current = true;
      try {
        await useExplorerStore.getState().pollTransferRefreshes(mountRoot);
      } finally {
        transferRefreshInFlightRef.current = false;
      }
    };
    const initialTimer = window.setTimeout(poll, 1000);
    const interval = window.setInterval(poll, transferRefreshPollMs);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
    };
  }, [mountRoot]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target?.matches("input, textarea, select, [contenteditable='true']") ?? false;
      const explorerState = useExplorerStore.getState();
      const multi = useMultiPanelStore.getState();
      const paneId = multi.activePaneId;
      if (!paneId) return;

      if (event.key === "Escape") {
        explorerState.cancelInlineEdit();
        explorerState.closeContextMenu();
        return;
      }
      if (editing) return;

      const commandId = shortcutCommandForEvent(event, shortcutMapRef.current, executableCommandIdsRef.current);
      if (commandId) {
        event.preventDefault();
        const pluginCommand = pluginCommandsRef.current.find((command) => command.id === commandId);
        if (pluginCommand) void runPluginCommand(pluginCommand, paneId, navigate);
        else runExplorerCommand(commandId, paneId, navigate);
      } else if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        void explorerState.navigateBack(paneId);
      } else if (event.altKey && event.key === "ArrowRight") {
        event.preventDefault();
        void explorerState.navigateForward(paneId);
      } else if (event.metaKey && event.key === "Backspace") {
        event.preventDefault();
        void explorerState.deleteSelected(paneId);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate]);

  useEffect(() => {
    if (!resizeTarget) return;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const applyResize = () => {
      resizeFrameRef.current = null;
      const clientX = pendingResizeXRef.current;
      if (resizeTarget === "sidebar") {
        const rect = workspaceRef.current?.getBoundingClientRect();
        if (rect) useExplorerStore.getState().setSidebarWidth(clamp(clientX - rect.left, minSidebarWidth, maxSidebarWidth));
      } else if (resizeTarget === "preview") {
        const rect = mainRef.current?.getBoundingClientRect();
        if (rect) useExplorerStore.getState().setPreviewWidth(clamp(rect.right - clientX, minPreviewWidth, maxPreviewWidth));
      } else if (resizeTarget === "claude") {
        const rect = workspaceRef.current?.getBoundingClientRect();
        if (rect) useExplorerStore.getState().setClaudePanelWidth(clamp(rect.right - clientX, minClaudePanelWidth, maxClaudePanelWidth));
      }
    };

    const onPointerMove = (event: globalThis.PointerEvent) => {
      pendingResizeXRef.current = event.clientX;
      if (resizeFrameRef.current === null) resizeFrameRef.current = window.requestAnimationFrame(applyResize);
    };

    const onPointerUp = () => setResizeTarget(null);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [resizeTarget]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const clearExternalHover = () => {
      if (externalHoverTimerRef.current !== null) {
        window.clearTimeout(externalHoverTimerRef.current);
        externalHoverTimerRef.current = null;
      }
      externalHoverTargetRef.current = null;
    };
    const scheduleExternalHover = (target: ExternalDropTarget | null) => {
      if (!target || target.kind !== "folder" || !target.destination || target.destination === activePathRef.current) {
        clearExternalHover();
        return;
      }
      const key = `${target.paneId}\n${target.destination}`;
      if (externalHoverTargetRef.current === key) return;
      clearExternalHover();
      externalHoverTargetRef.current = key;
      externalHoverTimerRef.current = window.setTimeout(() => {
        externalHoverTimerRef.current = null;
        const latestPath = useExplorerStore.getState().panes[target.paneId]?.listing?.path;
        if (latestPath !== target.destination) {
          void useExplorerStore.getState().navigatePane(target.paneId, target.destination);
        }
      }, folderHoverOpenDelayMs);
    };
    let webview;
    try {
      webview = getCurrentWebview();
    } catch {
      return;
    }

    void webview.onDragDropEvent((event) => {
      const payload = event.payload;
      if (payload.type === "leave") {
        clearExternalHover();
        return;
      }
      if (payload.type === "over") {
        scheduleExternalHover(externalDropTargetAt(payload.position, activePaneIdRef.current, activePathRef.current));
        return;
      }
      if (payload.type !== "drop" || payload.paths.length === 0) return;
      clearExternalHover();
      const target = externalDropTargetAt(payload.position, activePaneIdRef.current, activePathRef.current);
      if (!target) return;
      void useExplorerStore.getState().dropExternalPaths(target.paneId, payload.paths, target.destination);
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    }).catch((error) => {
      useExplorerStore.setState({ operationError: `External drop unavailable: ${String(error)}` });
    });
    return () => {
      disposed = true;
      clearExternalHover();
      unlisten?.();
    };
  }, []);

  const startSidebarResize = useCallback((event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setResizeTarget("sidebar");
  }, []);

  const startPreviewResize = useCallback((event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setResizeTarget("preview");
  }, []);
  const startClaudeResize = useCallback((event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setResizeTarget("claude");
  }, []);
  const navigateSidebar = useCallback((path: string) => {
    const paneId = useMultiPanelStore.getState().activePaneId;
    if (paneId) void useExplorerStore.getState().navigatePane(paneId, path);
  }, []);
  const handleSelectWorkspace = useCallback((workspaceId: string) => {
    void selectWorkspace(workspaceId, homePath);
  }, [homePath, selectWorkspace]);
  const handleCreateWorkspace = useCallback((title: string) => {
    void createWorkspace(title, homePath);
  }, [createWorkspace, homePath]);
  const handleRenameWorkspace = useCallback((workspaceId: string, title: string) => {
    void renameWorkspace(workspaceId, title);
  }, [renameWorkspace]);
  const handleDeleteWorkspace = useCallback((workspaceId: string) => {
    void deleteWorkspace(workspaceId, homePath);
  }, [deleteWorkspace, homePath]);

  const renderToolbar = useCallback(
    (paneId: string, path: string) => (
      <ConnectedExplorerToolbar
        paneId={paneId}
        fallbackPath={path}
        locationResults={locationResults}
        pluginCommands={pluginCommands}
        onNavigateRoute={navigate}
      />
    ),
    [locationResults, navigate, pluginCommands],
  );
  const renderPane = useCallback((paneId: string, path: string) => <ExplorerPane paneId={paneId} path={path} />, []);
  const inspector = useMemo(() => (previewVisible ? <ConnectedFileInspector /> : undefined), [previewVisible]);
  const renderContextHeader = useCallback(
    (tab: MultiPanelTab) => tab.mode === "compare" ? <FileSyncCompareBar tab={tab} mountRoot={mountRoot} /> : null,
    [mountRoot],
  );

  return (
    <section
      ref={workspaceRef}
      className={`explorer-workspace${sidebarVisible ? "" : " sidebar-collapsed"}${claudePanelOpen ? " claude-open" : ""}`}
      style={workspaceStyle}
    >
      {sidebarVisible ? (
        <>
          <ExplorerSidebar
            homePath={homePath}
            activePath={activePath}
            mountRoot={mountRoot}
            remotes={sidebarRemotes}
            remoteLoading={providersLoading}
            devices={mountedDevices}
            devicesLoading={devicesLoading}
            pinnedPaths={pinnedPaths}
            workspaceEntries={workspaceEntries}
            activeWorkspaceId={activeWorkspaceId}
            activeWorkspaceTitle={activeWorkspaceTitle}
            onNavigate={navigateSidebar}
            onRefreshDevices={refreshDevices}
            onSelectWorkspace={handleSelectWorkspace}
            onCreateWorkspace={handleCreateWorkspace}
            onRenameWorkspace={handleRenameWorkspace}
            onDeleteWorkspace={handleDeleteWorkspace}
          />
          <div className="explorer-sidebar-resizer" onPointerDown={startSidebarResize} />
        </>
      ) : null}
      <main ref={mainRef} className="explorer-main-shell">
        <MultiPanelWorkspace
          className="explorer-multipanel"
          renderToolbar={renderToolbar}
          renderContextHeader={renderContextHeader}
          renderAside={inspector}
          onAsideResizeStart={startPreviewResize}
          renderPane={renderPane}
        />
      </main>
      {claudePanelOpen ? (
        <>
          <div className="explorer-claude-resizer" onPointerDown={startClaudeResize} />
          <ExplorerClaudePanel />
        </>
      ) : null}
      <ExplorerBottomBar
        sidebarVisible={sidebarVisible}
        previewVisible={previewVisible}
        onToggleSidebar={() => useExplorerStore.getState().setSidebarVisible(!sidebarVisible)}
        onTogglePreview={() => useExplorerStore.getState().setPreviewVisible(!previewVisible)}
      />
      <ExplorerRenameStatus edit={inlineEdit} />
      <ExplorerNotifications notifications={notifications} onDismiss={dismissNotification} />
      {chatOverlayOpen ? <ExplorerChatOverlay /> : null}
      <ExplorerContextMenu />
      <ExplorerDialog />
    </section>
  );
});

function ExplorerRenameStatus(props: { edit: ExplorerInlineEditState | null }) {
  if (!props.edit) return null;
  const summary = renameStatusSummary(props.edit);
  return (
    <div className={`explorer-rename-status ${summary.tone}`} role="status" aria-live="polite">
      <span>{summary.text}</span>
    </div>
  );
}

function renameStatusSummary(edit: ExplorerInlineEditState): { text: string; tone: "ready" | "warning" } {
  if (edit.kind === "create") {
    if (edit.error) {
      return { text: `Create mode: ${edit.error}`, tone: "warning" };
    }
    return { text: "Create mode: Press Enter to create", tone: "ready" };
  }

  const batchItems = edit.batchItems && edit.batchItems.length > 1
    ? edit.batchItems
    : [{
        originalName: edit.originalName,
        value: edit.value,
        lockedExtension: edit.lockedExtension,
        error: edit.error,
      }];
  let ready = 0;
  let unchanged = 0;
  let invalid = 0;
  for (const item of batchItems) {
    if (item.error) {
      invalid += 1;
      continue;
    }
    const effectiveName = `${item.value.trim()}${item.lockedExtension}`;
    if (effectiveName === item.originalName) unchanged += 1;
    else ready += 1;
  }

  if (invalid === 0) {
    return { text: `Rename mode: Press Enter to review ${ready} ${ready === 1 ? "item" : "items"}`, tone: "ready" };
  }
  return {
    text: `Rename mode: ${ready} ready, ${unchanged} unchanged, ${invalid} need fixes`,
    tone: "warning",
  };
}

function ExplorerNotifications(props: {
  notifications: ExplorerNotification[];
  onDismiss: (id: number) => void;
}) {
  if (props.notifications.length === 0) return null;
  return (
    <div className="explorer-notifications" aria-live="polite" aria-atomic="false">
      {props.notifications.map((notification) => (
        <button
          key={notification.id}
          type="button"
          className={`explorer-notification ${notification.type}`}
          title={notification.message}
          onClick={() => props.onDismiss(notification.id)}
        >
          {compactNotificationMessage(notification.message)}
        </button>
      ))}
    </div>
  );
}

function compactNotificationMessage(message: string): string {
  const normalized = message.replace(/\s+/g, " ").trim();
  return normalized.length <= 64 ? normalized : `${normalized.slice(0, 61)}...`;
}

function ExplorerDialog() {
  const dialog = useExplorerStore((state) => state.dialog);
  if (!dialog) return null;
  if (dialog.kind === "batchRename") {
    const invalidCount = dialog.items.filter((item) => item.error).length;
    const firstInvalidIndex = dialog.items.findIndex((item) => item.error);
    const readyCount = dialog.items.filter((item) => !item.error && `${item.value.trim()}${item.lockedExtension}` !== item.originalName).length;
    const unchangedCount = dialog.items.length - readyCount - invalidCount;
    return createPortal(
      <div className="explorer-dialog-backdrop" role="presentation">
        <form
          className="explorer-dialog explorer-dialog-wide"
          role="dialog"
          aria-modal="true"
          aria-labelledby="explorer-dialog-title"
          onPointerDown={(event) => event.stopPropagation()}
          onSubmit={(event) => {
            event.preventDefault();
            void useExplorerStore.getState().confirmDialog();
          }}
        >
          <header className="batch-rename-header">
            <div>
              <h2 id="explorer-dialog-title">Review Renames</h2>
              <p>{readyCount} ready, {unchangedCount} unchanged, {invalidCount} need fixes.</p>
            </div>
            {invalidCount > 0 ? <span>{invalidCount} need fixes</span> : null}
          </header>
          <div className="batch-rename-table-head" aria-hidden="true">
            <span>Before</span>
            <span>After</span>
          </div>
          <div className="batch-rename-list">
            {dialog.items.map((item, index) => (
              <label className={`batch-rename-row${item.error ? " invalid" : ""}`} key={`${item.paneId}:${item.entryId}`}>
                <span title={item.originalName}>{item.originalName}</span>
                <div>
                  <div className="batch-rename-input">
                    <input
                      value={item.value}
                      autoComplete="off"
                      autoFocus={invalidCount > 0 ? index === firstInvalidIndex : index === 0}
                      aria-invalid={Boolean(item.error)}
                      onChange={(event) => useExplorerStore.getState().setBatchRenameValue(item.paneId, item.entryId, event.target.value)}
                    />
                    {item.lockedExtension ? <small>{item.lockedExtension}</small> : null}
                  </div>
                  {item.error ? <em>{item.error}</em> : (
                    <em className={`${`${item.value.trim()}${item.lockedExtension}` === item.originalName ? "muted" : "ready"}`}>
                      {`${item.value.trim()}${item.lockedExtension}` === item.originalName ? "Unchanged" : "Ready"}
                    </em>
                  )}
                </div>
              </label>
            ))}
          </div>
          <div className="explorer-dialog-actions">
            <button type="button" onClick={() => useExplorerStore.getState().closeDialog()}>Cancel</button>
            <button type="submit" disabled={readyCount === 0}>Confirm</button>
          </div>
        </form>
      </div>,
      document.body,
    );
  }
  const deleteLabel = dialog.paths.length === 1
    ? dialog.paths[0].split("/").filter(Boolean).pop() ?? dialog.paths[0]
    : `${dialog.paths.length} items`;

  return createPortal(
    <div className="explorer-dialog-backdrop" role="presentation">
      <form
        className="explorer-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="explorer-dialog-title"
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void useExplorerStore.getState().confirmDialog();
        }}
      >
        <h2 id="explorer-dialog-title">Delete Permanently</h2>
        <p>Delete <strong>{deleteLabel}</strong>? This cannot be undone.</p>
        <div className="explorer-dialog-actions">
          <button type="button" onClick={() => useExplorerStore.getState().closeDialog()}>Cancel</button>
          <button type="submit" className="danger">Delete</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

const compareActions: Array<{ value: FileSyncPlannedAction; label: string }> = [
  { value: "skip", label: "Skip" },
  { value: "copy_left_to_right", label: "Copy Left -> Right" },
  { value: "copy_right_to_left", label: "Copy Right -> Left" },
  { value: "delete_left", label: "Delete Left" },
  { value: "delete_right", label: "Delete Right" },
];

function FileSyncCompareBar(props: { tab: MultiPanelTab; mountRoot: string }) {
  const leftPane = props.tab.panes[0];
  const rightPane = props.tab.panes[1];
  const left = endpointFromExplorerPath(leftPane?.path ?? props.tab.path, props.mountRoot);
  const right = endpointFromExplorerPath(rightPane?.path ?? props.tab.path, props.mountRoot);
  const session = useFileSyncStore((state) => state.sessions[props.tab.id]);
  const pairs = useFileSyncStore((state) => state.pairs);
  const loadingPairs = useFileSyncStore((state) => state.loadingPairs);
  const pairError = useFileSyncStore((state) => state.pairError);

  useEffect(() => {
    useFileSyncStore.getState().ensureSession(props.tab.id, left, right);
    void useFileSyncStore.getState().loadPairs();
  }, [left.kind, left.localPath, left.providerType, left.remoteName, left.remotePath, props.tab.id,
    right.kind, right.localPath, right.providerType, right.remoteName, right.remotePath]);

  if (!session) return <div className="compare-strip"><span>Preparing compare workspace...</span></div>;
  const counts = compareCounts(session.rows);
  const plannedCount = session.rows.filter((row) => row.action !== "skip").length;

  const navigateToPair = (pairId: number) => {
    const pair = pairs.find((candidate) => candidate.id === pairId);
    if (!pair || !leftPane || !rightPane) return;
    useFileSyncStore.getState().selectPair(props.tab.id, pairId);
    void useExplorerStore.getState().navigatePane(leftPane.id, explorerPathFromEndpoint(pair.left, props.mountRoot));
    void useExplorerStore.getState().navigatePane(rightPane.id, explorerPathFromEndpoint(pair.right, props.mountRoot));
  };

  const swap = () => {
    if (!leftPane || !rightPane) return;
    useFileSyncStore.getState().swapRoots(props.tab.id);
    void useExplorerStore.getState().navigatePane(leftPane.id, explorerPathFromEndpoint(session.right, props.mountRoot));
    void useExplorerStore.getState().navigatePane(rightPane.id, explorerPathFromEndpoint(session.left, props.mountRoot));
  };

  const apply = async () => {
    const result = await useFileSyncStore.getState().apply(props.tab.id);
    if (result && leftPane && rightPane) {
      await Promise.all([
        useExplorerStore.getState().refreshPane(leftPane.id),
        useExplorerStore.getState().refreshPane(rightPane.id),
      ]);
    }
  };

  return (
    <section className="compare-strip">
      <div className="compare-strip-main">
        <div className="compare-title">
          <GitCompareArrows size={17} />
          <strong>Compare</strong>
          <span className={session.comparing ? "working" : session.stale ? "stale" : "ready"}>
            {session.comparing ? "Comparing..." : session.stale ? "Needs review" : "Ready"}
          </span>
        </div>
        <select
          aria-label="Saved sync pair"
          value={session.activePairId ?? ""}
          disabled={loadingPairs}
          onChange={(event) => event.target.value && navigateToPair(Number(event.target.value))}
        >
          <option value="">Saved pairs</option>
          {pairs.map((pair) => <option key={pair.id} value={pair.id}>{pair.name}</option>)}
        </select>
        <input
          aria-label="Sync pair name"
          value={session.pairName}
          placeholder="Saved pair name"
          onChange={(event) => useFileSyncStore.getState().setPairName(props.tab.id, event.target.value)}
        />
        <button type="button" onClick={() => void useFileSyncStore.getState().savePair(props.tab.id)}>Save Pair</button>
        <label className="compare-watch">
          <input
            type="checkbox"
            checked={session.watchMode}
            onChange={(event) => void useFileSyncStore.getState().setWatchMode(props.tab.id, event.target.checked)}
          />
          Watch
        </label>
        <button type="button" onClick={swap}>Swap</button>
        <button type="button" onClick={() => void useFileSyncStore.getState().compare(props.tab.id)} disabled={session.comparing}>
          Compare
        </button>
        <button type="button" className="primary" onClick={() => void apply()} disabled={session.applying || plannedCount === 0}>
          {session.applying ? "Applying..." : `Apply${plannedCount ? ` ${plannedCount}` : ""}`}
        </button>
      </div>
      <div className="compare-summary">
        <span>Left: {leftPane?.path ?? "--"}</span>
        <span>Right: {rightPane?.path ?? "--"}</span>
        <span>Left only: {counts.left_only}</span>
        <span>Right only: {counts.right_only}</span>
        <span>Different: {counts.different}</span>
        <span>Conflict: {counts.conflict}</span>
        {session.error || pairError ? <span className="error-text">{session.error ?? pairError}</span> : null}
        {session.message ? <span className="success-text">{session.message}</span> : null}
      </div>
      {session.rows.length > 0 ? (
        <details className="compare-results">
          <summary>{session.rows.length} comparison results</summary>
          <div className="compare-results-scroll">
            <table>
              <thead><tr><th>Path</th><th>Type</th><th>State</th><th>Left</th><th>Right</th><th>Action</th></tr></thead>
              <tbody>
                {session.rows.map((row) => (
                  <tr key={row.relativePath}>
                    <td>{row.relativePath}</td>
                    <td>{row.kind}</td>
                    <td>{row.disposition.replace(/_/g, " ")}</td>
                    <td title={compareSideTitle(row.left)}>{compareSideSummary(row.left)}</td>
                    <td title={compareSideTitle(row.right)}>{compareSideSummary(row.right)}</td>
                    <td>
                      <select
                        value={row.action}
                        onChange={(event) => useFileSyncStore.getState().setRowAction(
                          props.tab.id,
                          row.relativePath,
                          event.target.value as FileSyncPlannedAction,
                        )}
                      >
                        {compareActions.map((action) => <option key={action.value} value={action.value}>{action.label}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </section>
  );
}

const ConnectedExplorerToolbar = memo(function ConnectedExplorerToolbar(props: {
  paneId: string;
  fallbackPath: string;
  locationResults: ExplorerLocationResult[];
  pluginCommands: PluginCommandEntry[];
  onNavigateRoute: (path: string) => void;
}) {
  const state = useExplorerStore(useShallow((explorer) => {
    const pane = explorer.panes[props.paneId];
    return {
      path: pane?.listing?.path ?? props.fallbackPath,
      commandQuery: pane?.commandQuery ?? "",
      viewMode: explorer.paneViewModes[props.paneId] ?? explorer.viewMode,
      showHidden: explorer.paneShowHidden[props.paneId] ?? explorer.showHidden,
      canGoBack: Boolean(pane?.backHistory.length),
      canGoForward: Boolean(pane?.forwardHistory.length),
      canCreateFile: explorer.canCreateItem(props.paneId, "file"),
      canCreateFolder: explorer.canCreateItem(props.paneId, "folder"),
    };
  }));
  const onNavigate = useCallback((path: string) => {
    void useExplorerStore.getState().navigatePane(props.paneId, path);
  }, [props.paneId]);
  const onNavigateLocation = useCallback((path: string) => {
    void useExplorerStore.getState().navigatePane(props.paneId, path);
  }, [props.paneId]);
  const onBack = useCallback(() => {
    void useExplorerStore.getState().navigateBack(props.paneId);
  }, [props.paneId]);
  const onForward = useCallback(() => {
    void useExplorerStore.getState().navigateForward(props.paneId);
  }, [props.paneId]);
  const onParent = useCallback(() => {
    void useExplorerStore.getState().navigateParent(props.paneId);
  }, [props.paneId]);
  const onRefresh = useCallback(() => {
    void useExplorerStore.getState().refreshPane(props.paneId);
  }, [props.paneId]);
  const onCommandQuery = useCallback((query: string) => {
    useExplorerStore.getState().setCommandQuery(props.paneId, query);
  }, [props.paneId]);
  const onToggleHidden = useCallback(() => {
    void useExplorerStore.getState().toggleHidden(props.paneId);
  }, [props.paneId]);
  const onViewMode = useCallback((mode: "grid" | "list") => {
    useExplorerStore.getState().setViewMode(mode, props.paneId);
  }, [props.paneId]);
  const onCreateFile = useCallback(() => {
    void useExplorerStore.getState().createItem(props.paneId, "file");
  }, [props.paneId]);
  const onCreateFolder = useCallback(() => {
    void useExplorerStore.getState().createItem(props.paneId, "folder");
  }, [props.paneId]);
  const onCut = useCallback(() => {
    useExplorerStore.getState().cutSelected(props.paneId);
  }, [props.paneId]);
  const onCopy = useCallback(() => {
    useExplorerStore.getState().copySelected(props.paneId);
  }, [props.paneId]);
  const onPaste = useCallback(() => {
    void useExplorerStore.getState().pasteIntoPane(props.paneId);
  }, [props.paneId]);
  const onRename = useCallback(() => {
    void useExplorerStore.getState().renameSelected(props.paneId);
  }, [props.paneId]);
  const onDelete = useCallback(() => {
    void useExplorerStore.getState().deleteSelected(props.paneId);
  }, [props.paneId]);
  const onUploadFiles = useCallback(() => {
    void useExplorerStore.getState().uploadIntoPane(props.paneId, "files");
  }, [props.paneId]);
  const onUploadFolder = useCallback(() => {
    void useExplorerStore.getState().uploadIntoPane(props.paneId, "folders");
  }, [props.paneId]);
  const onCompare = useCallback(() => {
    const path = useExplorerStore.getState().panes[props.paneId]?.listing?.path ?? props.fallbackPath;
    useMultiPanelStore.getState().addCompareTab(path, path);
  }, [props.fallbackPath, props.paneId]);
  const pluginCommandById = useMemo(
    () => new Map(props.pluginCommands.map((command) => [command.id, command])),
    [props.pluginCommands],
  );
  const onRunCommand = useCallback((commandId: string) => {
    const pluginCommand = pluginCommandById.get(commandId);
    if (pluginCommand) {
      void runPluginCommand(pluginCommand, props.paneId, props.onNavigateRoute);
      return;
    }
    runExplorerCommand(commandId, props.paneId, props.onNavigateRoute);
  }, [pluginCommandById, props.onNavigateRoute, props.paneId]);

  return (
    <ExplorerToolbar
      {...state}
      paneId={props.paneId}
      locationResults={props.locationResults}
      pluginCommands={props.pluginCommands}
      onNavigate={onNavigate}
      onNavigateLocation={onNavigateLocation}
      onBack={onBack}
      onForward={onForward}
      onParent={onParent}
      onRefresh={onRefresh}
      onCommandQuery={onCommandQuery}
      onViewMode={onViewMode}
      onToggleHidden={onToggleHidden}
      onCreateFile={onCreateFile}
      onCreateFolder={onCreateFolder}
      onCut={onCut}
      onCopy={onCopy}
      onPaste={onPaste}
      onRename={onRename}
      onDelete={onDelete}
      onUploadFiles={onUploadFiles}
      onUploadFolder={onUploadFolder}
      onCompare={onCompare}
      onRunCommand={onRunCommand}
    />
  );
});

function shortcutCommandForEvent(
  event: KeyboardEvent,
  shortcuts: ShortcutMap,
  commandIds: readonly string[],
): string | null {
  for (const commandId of commandIds) {
    if (shortcutMatchesEvent(shortcuts[commandId], event)) return commandId;
  }
  return null;
}

function defaultExplorerShortcutMap(keymapIndex = 0): ShortcutMap {
  const base = /mac|iphone|ipad|ipod/i.test(navigator.platform)
    ? defaultMacExplorerShortcuts
    : defaultNonMacExplorerShortcuts;
  if (keymapIndex === 1) {
    return { ...base, ...vscodeExplorerShortcutOverrides };
  }
  if (keymapIndex === 2) {
    return { ...base, ...finderExplorerShortcutOverrides };
  }
  return { ...base };
}

function runExplorerCommand(commandId: string, paneId: string, navigateRoute: (path: string) => void): void {
  const explorer = useExplorerStore.getState();
  const multi = useMultiPanelStore.getState();
  const activeTab = multi.tabs.find((tab) => tab.id === multi.activeTabId) ?? multi.tabs[0];
  if (commandId.startsWith("plugin.")) {
    void runPluginCommandById(commandId, paneId, navigateRoute);
    return;
  }
  switch (commandId) {
    case "search.toggle":
      focusExplorerSearch(paneId, "search");
      break;
    case "explorer.open_palette":
      focusExplorerSearch(paneId, "command");
      break;
    case "app.toggle_transfers":
      navigateRoute("/transfers");
      break;
    case "app.open_settings":
      navigateRoute("/settings");
      break;
    case "app.toggle_plugin_launcher":
      navigateRoute("/hub");
      break;
    case "clipboard.publish_shared":
      void publishSharedClipboard();
      break;
    case "clipboard.apply_shared":
      void applySharedClipboardToSystem();
      break;
    case "explorer.new_tab":
      multi.addTab(activeTab?.path ?? explorer.panes[paneId]?.listing?.path ?? "/", activeTab?.title);
      break;
    case "explorer.restore_tab":
      multi.restoreTab();
      break;
    case "explorer.close_pane":
      if (activeTab && activeTab.panes.length > 1) multi.closePane(paneId);
      else if (activeTab) multi.closeTab(activeTab.id);
      break;
    case "explorer.restore_pane":
      multi.restorePane();
      break;
    case "explorer.split_vertical":
      multi.splitPane(paneId, "vertical");
      break;
    case "explorer.split_horizontal":
      multi.splitPane(paneId, "horizontal");
      break;
    case "explorer.refresh":
      void explorer.refreshPane(paneId);
      break;
    case "explorer.rename":
      void explorer.renameSelected(paneId);
      break;
    case "explorer.delete":
      void explorer.deleteSelected(paneId);
      break;
    case "explorer.download":
      void explorer.downloadSelected(paneId);
      break;
    case "explorer.open_with":
      void explorer.openWithSelected(paneId);
      break;
    case "explorer.copy":
      explorer.copySelected(paneId);
      break;
    case "explorer.cut":
      explorer.cutSelected(paneId);
      break;
    case "explorer.paste":
      void explorer.pasteIntoPane(paneId);
      break;
    case "explorer.undo":
      void undoLatestTransferOperation();
      break;
    case "explorer.redo":
      void redoLatestTransferOperation();
      break;
    case "explorer.toggle_hidden":
      void explorer.toggleHidden(paneId);
      break;
    case "explorer.preview.toggle":
      explorer.setPreviewVisible(!explorer.previewVisible);
      break;
    case "explorer.sidebar.toggle":
      explorer.setSidebarVisible(!explorer.sidebarVisible);
      break;
    case "explorer.toggle_chat":
      if (explorer.chatOverlayOpen && !useClaudeSessionStore.getState().status?.running) {
        useClaudeSessionStore.getState().clearConversation();
      }
      explorer.toggleChatOverlay();
      break;
    case "explorer.toggle_claude":
      explorer.toggleClaudePanel();
      break;
    case "explorer.next_workspace": {
      if (multi.tabs.length <= 1) break;
      const activeIndex = Math.max(0, multi.tabs.findIndex((tab) => tab.id === multi.activeTabId));
      const nextTab = multi.tabs[(activeIndex + 1) % multi.tabs.length];
      if (nextTab) multi.selectTab(nextTab.id);
      break;
    }
    case "explorer.tab_1":
    case "explorer.tab_2":
    case "explorer.tab_3":
    case "explorer.tab_4":
    case "explorer.tab_5":
    case "explorer.tab_6":
    case "explorer.tab_7":
    case "explorer.tab_8":
    case "explorer.tab_9": {
      const index = Number(commandId.slice("explorer.tab_".length)) - 1;
      const tab = multi.tabs[index];
      if (tab) multi.selectTab(tab.id);
      break;
    }
  }
}

async function runPluginCommand(
  command: PluginCommandEntry,
  paneId: string,
  navigateRoute: (path: string) => void,
): Promise<void> {
  try {
    const selectedPaths = selectedPathsForPane(useExplorerStore.getState().panes[paneId]);
    const result = await pluginCommandRun({ commandId: command.id, selectedPaths });
    if (result.targetRoute) navigateRoute(result.targetRoute);
    if (result.handled) {
      publishPluginNotifications(result.notifications, result.message);
      return;
    }
    useExplorerStore.setState({
      operationError: `Plugin command "${result.label}" could not run: ${result.message}`,
    });
  } catch (error) {
    useExplorerStore.setState({
      operationError: `Plugin command "${command.label}" failed: ${errorText(error)}`,
    });
  }
}

async function runPluginCommandById(
  commandId: string,
  paneId: string,
  navigateRoute: (path: string) => void,
): Promise<void> {
  try {
    const selectedPaths = selectedPathsForPane(useExplorerStore.getState().panes[paneId]);
    const result = await pluginCommandRun({ commandId, selectedPaths });
    if (result.targetRoute) navigateRoute(result.targetRoute);
    if (result.handled) {
      publishPluginNotifications(result.notifications, result.message);
      return;
    }
    useExplorerStore.setState({
      operationError: `Plugin command "${result.label}" could not run: ${result.message}`,
    });
  } catch (error) {
    useExplorerStore.setState({
      operationError: `Plugin command "${commandId}" failed: ${errorText(error)}`,
    });
  }
}

function focusExplorerSearch(paneId: string, mode: "search" | "command"): void {
  useExplorerStore.getState().setCommandQuery(paneId, mode === "command" ? ">" : "");
  window.dispatchEvent(new CustomEvent(explorerSearchFocusEvent, { detail: { paneId, mode } }));
}

async function undoLatestTransferOperation(): Promise<void> {
  const explorer = useExplorerStore.getState();
  try {
    const loadedRows = useTransfersStore.getState().transfers?.rows;
    const rows = loadedRows ?? (await transfersSnapshot({ limit: 500 })).rows;
    const latest = newestUndoableTransfer(rows);
    if (!latest) {
      explorer.pushNotification("No completed rename or move is available to undo.", "info", 3500);
      return;
    }

    const snapshot = await operationQueueUndo(latest.undoTokenId);
    useOperationQueueStore.setState({ snapshot, error: null });
    await useTransfersStore.getState().load(undefined, { silent: true });
    explorer.pushNotification(`Undo queued for ${latest.fileName || transferTypeLabel(latest.transferType)}.`, "success", 3500);
  } catch (error) {
    explorer.pushNotification(`Undo failed: ${errorText(error)}`, "error", 4500);
  }
}

async function redoLatestTransferOperation(): Promise<void> {
  const explorer = useExplorerStore.getState();
  try {
    const snapshot = await operationQueueRedo();
    useOperationQueueStore.setState({ snapshot, error: null });
    await useTransfersStore.getState().load(undefined, { silent: true });
    explorer.pushNotification("Redo queued.", "success", 3500);
  } catch (error) {
    explorer.pushNotification(`Redo failed: ${errorText(error)}`, "error", 4500);
  }
}

function newestUndoableTransfer(rows: readonly TransferRecord[]): TransferRecord | null {
  return rows
    .filter((row) => row.undoable && row.undoTokenId > 0 && row.status === "completed")
    .sort((left, right) => transferRecencyMs(right) - transferRecencyMs(left) || right.id - left.id)[0] ?? null;
}

function transferRecencyMs(row: TransferRecord): number {
  return row.completedAtMs || row.startedAtMs || row.queuedAtMs || row.id;
}

function transferTypeLabel(type: TransferRecord["transferType"]): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

async function publishSharedClipboard(): Promise<void> {
  try {
    let published = await clipboardPublishShared();
    if (!published) {
      const systemText = await readText().catch(() => "");
      if (systemText.trim()) {
        await clipboardSetLocal(textClipboardPayload(systemText));
        published = await clipboardPublishShared();
      }
    }
    if (!published) {
      const image = await clipboardImagePng();
      if (image) {
        published = await clipboardPublishImageBytes({
          bytes: [...image.bytes],
          width: image.width,
          height: image.height,
          mimeType: "image/png",
        });
      }
    }
    if (!published) {
      useExplorerStore.setState({
        operationError: "Shared clipboard publish failed. Check that the proxy is configured and the local clipboard has content.",
      });
    }
  } catch (error) {
    useExplorerStore.setState({ operationError: `Shared clipboard publish failed: ${errorText(error)}` });
  }
}

function textClipboardPayload(text: string): ClipboardPayload {
  return {
    kind: text ? "text" : "empty",
    origin: "local_system",
    payload_id: "",
    source_device_id: "",
    source_device_name: "",
    revision: 0,
    created_unix_ms: 0,
    text,
    html: "",
    file_refs: [],
    images: [],
  };
}

async function applySharedClipboardToSystem(): Promise<void> {
  try {
    const payload = await clipboardApplyShared();
    await writeSharedClipboardPayload(payload);
  } catch (error) {
    useExplorerStore.setState({ operationError: `Shared clipboard apply failed: ${errorText(error)}` });
  }
}

async function writeSharedClipboardPayload(payload: ClipboardPayload): Promise<void> {
  switch (payload.kind) {
    case "text":
      if (!payload.text) break;
      await writeText(payload.text);
      return;
    case "html":
      if (!payload.html && !payload.text) break;
      if (payload.html) await writeHtml(payload.html, payload.text || undefined);
      else await writeText(payload.text);
      return;
    case "file_refs": {
      const localItems = sharedClipboardLocalPasteItems(payload);
      const remoteItems = await sharedClipboardRemotePasteItems(payload);
      const nativeItems = [...localItems, ...remoteItems];
      if (nativeItems.length > 0 && await clipboardWriteFileRefs(nativeItems)) {
        if (remoteItems.length > 0) {
          useExplorerStore.getState().pushNotification(
            `Prepared ${remoteItems.length} shared remote ${remoteItems.length === 1 ? "item" : "items"} for clipboard.`,
            "success",
            3500,
            false,
          );
        }
        return;
      }
      const text = sharedClipboardText(payload);
      if (!text) break;
      await writeText(text);
      return;
    }
    case "image": {
      const image = payload.images.find((candidate) => candidate.blob_id);
      if (!image) break;
      const bytes = await clipboardSharedImageBytes(image.blob_id);
      await writeImage(new Uint8Array(bytes));
      return;
    }
    case "empty":
      break;
  }
  throw new Error("This shared clipboard payload cannot be applied to the system clipboard yet.");
}

function sharedClipboardText(payload: ClipboardPayload): string {
  switch (payload.kind) {
    case "text":
      return payload.text;
    case "html":
      return payload.html || payload.text;
    case "file_refs":
      return payload.file_refs
        .map((ref) => ref.local_path || sharedClipboardRemoteLabel(ref))
        .filter(Boolean)
        .join("\n");
    default:
      return "";
  }
}

function sharedClipboardRemoteLabel(ref: ClipboardPayload["file_refs"][number]): string {
  const providerType = clipboardRefValue(ref.provider_type);
  const remoteName = clipboardRefValue(ref.remote_name);
  const remotePath = clipboardRefValue(ref.remote_path);
  if (!remoteName && !remotePath) return "";
  const provider = providerType ? `${providerType}/` : "";
  return `${provider}${remoteName}:${remotePath}`;
}

function sharedClipboardLocalPasteItems(payload: ClipboardPayload) {
  return payload.file_refs
    .map((ref) => ({
      path: clipboardRefValue(ref.local_path),
      remoteName: clipboardRefValue(ref.remote_name),
      remotePath: clipboardRefValue(ref.remote_path),
      isDirectory: ref.is_dir,
    }))
    .filter((ref) => ref.path && !ref.remoteName && !ref.remotePath)
    .map((ref) => ({ path: ref.path, isDirectory: ref.isDirectory }));
}

async function sharedClipboardRemotePasteItems(payload: ClipboardPayload) {
  const remoteRefs = payload.file_refs
    .map((ref) => ({
      providerType: clipboardRefValue(ref.provider_type),
      remoteName: clipboardRefValue(ref.remote_name),
      remotePath: clipboardRefValue(ref.remote_path),
      localPath: clipboardRefValue(ref.local_path),
      isDirectory: ref.is_dir,
    }))
    .filter((ref) => !ref.localPath && ref.providerType && ref.remoteName && ref.remotePath);
  if (remoteRefs.length === 0) return [];
  useExplorerStore.getState().pushNotification(
    `Preparing ${remoteRefs.length} shared remote ${remoteRefs.length === 1 ? "item" : "items"} for clipboard...`,
    "info",
    3500,
    false,
  );
  try {
    const prepared = await explorerPrepareDragItems({
      items: remoteRefs.map((ref) => ({
        path: remoteClipboardMountPath(ref),
        isDirectory: ref.isDirectory,
      })),
    });
    if (prepared.skipped.length > 0) {
      useExplorerStore.getState().pushNotification(
        `Skipped ${prepared.skipped.length} shared remote ${prepared.skipped.length === 1 ? "item" : "items"} while preparing clipboard.`,
        "error",
        4500,
        false,
      );
    }
    return prepared.items.map((item) => ({ path: item.localPath, isDirectory: item.isDirectory }));
  } catch (error) {
    useExplorerStore.getState().pushNotification(
      `Shared remote clipboard preparation failed: ${errorText(error)}`,
      "error",
      5500,
      false,
    );
    return [];
  }
}

function remoteClipboardMountPath(ref: {
  providerType: string;
  remoteName: string;
  remotePath: string;
}): string {
  const app = useAppStore.getState().app;
  const homePath = app?.environment.homeDir ?? "/";
  const settingsMountPath = selectAdvancedPreferences(useSettingsStore.getState().settings?.document).mountPath;
  const mountRoot = resolveMountRoot(homePath, settingsMountPath || app?.environment.mountPath || ".misty/mnt");
  return joinPath(mountRoot, ref.providerType, ref.remoteName, ref.remotePath);
}

function clipboardRefValue(value: string): string {
  return value.trim();
}

const ConnectedFileInspector = memo(function ConnectedFileInspector() {
  const activePaneId = useMultiPanelStore((state) => state.activePaneId);
  const { listing, selectedEntry, selectedCount, tags } = useExplorerStore(useShallow((state) => {
    const pane = state.panes[activePaneId];
    const selectedCount = pane?.selectedIds.length ?? 0;
    const selectedEntry = selectedCount === 1 ? selectedEntryForPane(pane) : null;
    const libraryItem = selectedEntry
      ? [
        ...(state.library?.recentFiles ?? []),
        ...(state.library?.starredFiles ?? []),
      ].find((item) => item.path === selectedEntry.path)
      : undefined;
    return {
      listing: pane?.listing ?? null,
      selectedEntry,
      selectedCount,
      tags: libraryItem?.tags ?? emptyInspectorTags,
    };
  }));
  const onOpen = useCallback(() => {
    if (selectedEntry) void useExplorerStore.getState().openEntry(activePaneId, selectedEntry);
  }, [activePaneId, selectedEntry]);
  const onDownload = useCallback(() => {
    void useExplorerStore.getState().downloadSelected(activePaneId);
  }, [activePaneId]);
  const onMore = useCallback((x: number, y: number) => {
    useExplorerStore.getState().openContextMenu(activePaneId, x, y, selectedEntry?.id ?? null);
  }, [activePaneId, selectedEntry?.id]);
  const onTagsChange = useCallback((nextTags: string[]) => {
    if (selectedEntry) void useExplorerStore.getState().setLibraryTags(selectedEntry, nextTags);
  }, [selectedEntry]);
  return (
    <FileInspector
      listing={listing}
      selectedEntry={selectedEntry}
      selectedCount={selectedCount}
      tags={tags}
      onOpen={onOpen}
      onDownload={onDownload}
      onMore={onMore}
      onTagsChange={onTagsChange}
    />
  );
});

const ExplorerChatOverlay = memo(function ExplorerChatOverlay() {
  const activePaneId = useMultiPanelStore((state) => state.activePaneId);
  const { listing, selectedEntry } = useExplorerStore(useShallow((state) => {
    const pane = state.panes[activePaneId];
    return {
      listing: pane?.listing ?? null,
      selectedEntry: selectedEntryForPane(pane),
    };
  }));
  const { status, messages, error, refreshStatus, sendPrompt, abortPrompt, clearConversation } = useClaudeSessionStore(useShallow((state) => ({
    status: state.status,
    messages: state.messages,
    error: state.error,
    refreshStatus: state.refreshStatus,
    sendPrompt: state.sendPrompt,
    abortPrompt: state.abortPrompt,
    clearConversation: state.clearConversation,
  })));
  const [prompt, setPrompt] = useState("");
  const logRef = useRef<HTMLDivElement | null>(null);
  const workingDirectory = listing?.path ?? "";
  const running = status?.running ?? false;
  const installed = status?.installed ?? false;

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  const submitPrompt = useCallback(() => {
    const trimmed = prompt.trim();
    if (!trimmed || running) return;
    setPrompt("");
    void sendPrompt({
      displayPrompt: trimmed,
      prompt: buildClaudePrompt(trimmed, workingDirectory, selectedEntry?.path ?? null),
      cwd: workingDirectory || null,
    });
  }, [prompt, running, selectedEntry?.path, sendPrompt, workingDirectory]);

  const openPanel = useCallback(() => {
    useExplorerStore.getState().toggleChatOverlay();
    useExplorerStore.getState().setClaudePanelOpen(true);
  }, []);

  const closeOverlay = useCallback(() => {
    useExplorerStore.getState().toggleChatOverlay();
    if (!running) {
      clearConversation();
    }
    setPrompt("");
  }, [clearConversation, running]);

  return (
    <section className="explorer-chat-overlay" aria-label="Explorer chat">
      <header>
        <span>
          <MessageSquare size={16} />
          Chat
          {running ? <small>Running</small> : null}
        </span>
        <button type="button" aria-label="Close chat" onClick={closeOverlay}>
          <X size={16} />
        </button>
      </header>
      <div>
        <div className="explorer-chat-status">
          <dl>
            <dt>Status</dt>
            <dd>{status ? (installed ? "Claude CLI ready" : "Claude CLI not found") : "Checking Claude CLI..."}</dd>
            <dt>Folder</dt>
            <dd>{workingDirectory || "No active folder"}</dd>
            <dt>Selection</dt>
            <dd>{selectedEntry?.path ?? "None"}</dd>
          </dl>
          {error ? <p className="error">{error}</p> : null}
        </div>
        <div ref={logRef} className="explorer-chat-log" aria-live="polite">
          {messages.length === 0 ? (
            <p className="empty">Ask about the active folder or selected file.</p>
          ) : messages.map((message) => (
            <article key={message.id} className={`explorer-chat-message ${message.role}`}>
              <strong>{message.role === "user" ? "You" : message.role === "tool" ? "Tool" : message.role === "error" ? "Error" : "Claude"}</strong>
              <pre>{message.text || (message.role === "assistant" && running ? "Thinking..." : "")}</pre>
            </article>
          ))}
        </div>
        <form
          className="explorer-chat-composer"
          onSubmit={(event) => {
            event.preventDefault();
            submitPrompt();
          }}
        >
          <textarea
            value={prompt}
            rows={3}
            placeholder={installed ? "Ask Misty..." : "Install Claude Code CLI to enable chat"}
            disabled={!installed || running}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                submitPrompt();
              }
            }}
          />
          <div>
            <button type="button" className="secondary" onClick={openPanel}>Open Panel</button>
            {running ? (
              <button type="button" onClick={abortPrompt}>Stop</button>
            ) : (
              <button type="submit" disabled={!installed || !prompt.trim()}>Send</button>
            )}
          </div>
        </form>
      </div>
    </section>
  );
});

const ExplorerClaudePanel = memo(function ExplorerClaudePanel() {
  const activePaneId = useMultiPanelStore((state) => state.activePaneId);
  const { listing, selectedEntry } = useExplorerStore(useShallow((state) => {
    const pane = state.panes[activePaneId];
    return {
      listing: pane?.listing ?? null,
      selectedEntry: selectedEntryForPane(pane),
    };
  }));
  const { status, messages, error, refreshStatus, sendPrompt, abortPrompt } = useClaudeSessionStore(useShallow((state) => ({
    status: state.status,
    messages: state.messages,
    error: state.error,
    refreshStatus: state.refreshStatus,
    sendPrompt: state.sendPrompt,
    abortPrompt: state.abortPrompt,
  })));
  const [prompt, setPrompt] = useState("");
  const logRef = useRef<HTMLDivElement | null>(null);
  const workingDirectory = listing?.path ?? "";
  const running = status?.running ?? false;
  const installed = status?.installed ?? false;

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  const submitPrompt = useCallback(() => {
    const trimmed = prompt.trim();
    if (!trimmed || running) return;
    const requestPrompt = buildClaudePrompt(trimmed, workingDirectory, selectedEntry?.path ?? null);
    setPrompt("");
    void sendPrompt({
      displayPrompt: trimmed,
      prompt: requestPrompt,
      cwd: workingDirectory || null,
    });
  }, [prompt, running, selectedEntry?.path, sendPrompt, workingDirectory]);

  return (
    <aside className="explorer-claude-panel" aria-label="Claude">
      <header>
        <span>
          <MessageSquare size={16} />
          Claude
          {running ? <small>Running</small> : null}
        </span>
        <button type="button" aria-label="Close Claude" onClick={() => useExplorerStore.getState().setClaudePanelOpen(false)}>
          <X size={16} />
        </button>
      </header>
      <div>
        <div className="explorer-claude-status">
          <dl>
            <dt>Status</dt>
            <dd>{status ? (installed ? "Claude CLI ready" : "Claude CLI not found") : "Checking Claude CLI..."}</dd>
            <dt>Working directory</dt>
            <dd>{workingDirectory || "No active folder"}</dd>
            <dt>Selection</dt>
            <dd>{selectedEntry?.path ?? "None"}</dd>
          </dl>
          {error ? <p className="error">{error}</p> : null}
        </div>
        <div ref={logRef} className="explorer-claude-log" aria-live="polite">
          {messages.length === 0 ? (
            <p className="empty">Ask Claude about the active folder or selected file.</p>
          ) : messages.map((message) => (
            <article key={message.id} className={`explorer-claude-message ${message.role}`}>
              <strong>{message.role === "user" ? "You" : message.role === "tool" ? "Tool" : message.role === "error" ? "Error" : "Claude"}</strong>
              <pre>{message.text || (message.role === "assistant" && running ? "Thinking..." : "")}</pre>
            </article>
          ))}
        </div>
        <form
          className="explorer-claude-composer"
          onSubmit={(event) => {
            event.preventDefault();
            submitPrompt();
          }}
        >
          <textarea
            value={prompt}
            rows={3}
            placeholder={installed ? "Ask about this folder..." : "Install Claude Code CLI to enable this panel"}
            disabled={!installed || running}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                submitPrompt();
              }
            }}
          />
          <div>
            {running ? (
              <button type="button" onClick={abortPrompt}>Stop</button>
            ) : (
              <button type="submit" disabled={!installed || !prompt.trim()}>Send</button>
            )}
          </div>
        </form>
      </div>
    </aside>
  );
});

function buildClaudePrompt(userPrompt: string, workingDirectory: string, selectedPath: string | null): string {
  const context = [
    "You are helping inside Misty, a desktop file manager.",
    workingDirectory ? `Current folder: ${workingDirectory}` : "Current folder: none",
    selectedPath ? `Selected item: ${selectedPath}` : "Selected item: none",
  ].join("\n");
  return `${context}\n\nUser request:\n${userPrompt}`;
}

const ExplorerContextMenu = memo(function ExplorerContextMenu() {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const shortcutHintsEnabled = useSettingsStore((state) =>
    selectShortcutPreferences(state.settings?.document).shortcutHintsEnabled,
  );
  const {
    open,
    x,
    y,
    paneId,
    entryId,
    hasClipboard,
    showHidden,
    targetEntry,
    hasSelection,
    hasRemoteSelection,
    targetPinned,
    targetCanOpenWith,
    canCreateFile,
    canCreateFolder,
  } = useExplorerStore(useShallow((state) => {
    const { open, x, y, paneId, entryId } = state.contextMenu;
    const targetPane = open ? state.panes[paneId] : undefined;
    const targetEntry = open && entryId
      ? targetPane?.listing?.entries.find((entry) => entry.id === entryId) ?? null
      : null;
    const selectedCount = open ? selectedActionableEntryCount(targetPane) : 0;
    const remoteSelectedCount = open ? selectedRemoteEntryCount(targetPane) : 0;
    const pinnedPaths = open && entryId ? state.pinnedPaths : emptyPinnedPaths;
    return {
      open,
      x,
      y,
      paneId,
      entryId,
      hasClipboard: Boolean(state.clipboard?.items.length),
      showHidden: state.paneShowHidden[paneId] ?? state.showHidden,
      targetEntry,
      hasSelection: Boolean(entryId && selectedCount),
      hasRemoteSelection: Boolean(remoteSelectedCount),
      targetPinned: Boolean(targetEntry && !targetEntry.isDeleted && pinnedPaths.some((path) => normalizedPath(path) === normalizedPath(targetEntry.path))),
      targetCanOpenWith: Boolean(targetEntry && !targetEntry.isDeleted && targetEntry.kind !== "folder" && targetEntry.kind !== "symlink"),
      canCreateFile: state.canCreateItem(paneId, "file"),
      canCreateFolder: state.canCreateItem(paneId, "folder"),
    };
  }));

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: globalThis.PointerEvent) => {
      const target = event.target as Node | null;
      if (target && menuRef.current?.contains(target)) return;
      useExplorerStore.getState().closeContextMenu();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") useExplorerStore.getState().closeContextMenu();
    };
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  if (!open) return null;

  const primaryShortcut = shortcutHintsEnabled ? primaryShortcutLabel() : "";
  const selectionDisabledReason = hasSelection ? undefined : "Select a file or folder first.";
  const createDisabledReason = "New items are only available in writable folders.";
  const shortcut = (value: string) => shortcutHintsEnabled ? value : undefined;

  const run = (action: () => void) => {
    useExplorerStore.getState().closeContextMenu();
    action();
  };

  return createPortal(
    <div
      ref={menuRef}
      className="explorer-context-menu"
      style={{ left: x, top: y }}
      onPointerDown={(event) => event.stopPropagation()}
      role="menu"
    >
      <ContextMenuItem
        icon={<FolderPlus size={17} />}
        label="New Folder"
        shortcut={shortcut(`${primaryShortcut}+Shift+N`)}
        disabled={!canCreateFolder}
        disabledReason={createDisabledReason}
        onRun={() => run(() => void useExplorerStore.getState().createItem(paneId, "folder"))}
      />
      <ContextMenuItem
        icon={<FilePlus size={17} />}
        label="New File"
        disabled={!canCreateFile}
        disabledReason={createDisabledReason}
        onRun={() => run(() => void useExplorerStore.getState().createItem(paneId, "file"))}
      />
      <div className="context-menu-separator" />
      <ContextMenuItem
        icon={<Copy size={17} />}
        label="Copy"
        shortcut={shortcut(`${primaryShortcut}+C`)}
        disabled={!hasSelection}
        disabledReason={selectionDisabledReason}
        onRun={() => run(() => useExplorerStore.getState().copySelected(paneId))}
      />
      <ContextMenuItem
        icon={<Scissors size={17} />}
        label="Cut"
        shortcut={shortcut(`${primaryShortcut}+X`)}
        disabled={!hasSelection}
        disabledReason={selectionDisabledReason}
        onRun={() => run(() => useExplorerStore.getState().cutSelected(paneId))}
      />
      <ContextMenuItem
        icon={<Clipboard size={17} />}
        label="Paste"
        shortcut={shortcut(`${primaryShortcut}+V`)}
        disabled={!hasClipboard}
        disabledReason={hasClipboard ? undefined : "Copy or cut something first."}
        onRun={() => run(() => void useExplorerStore.getState().pasteIntoPane(paneId))}
      />
      <div className="context-menu-separator" />
      <ContextMenuItem
        icon={<Pencil size={17} />}
        label="Rename"
        shortcut={shortcut("Enter")}
        disabled={!hasSelection}
        disabledReason={selectionDisabledReason}
        onRun={() => run(() => void useExplorerStore.getState().renameSelected(paneId))}
      />
      <ContextMenuItem
        icon={<Trash2 size={17} />}
        label="Delete"
        shortcut={shortcut("Del")}
        disabled={!hasSelection}
        disabledReason={selectionDisabledReason}
        onRun={() => run(() => void useExplorerStore.getState().deleteSelected(paneId))}
      />
      <ContextMenuItem
        icon={<Download size={17} />}
        label="Download"
        disabled={!hasRemoteSelection}
        disabledReason="Download is available for remote files and folders."
        onRun={() => run(() => void useExplorerStore.getState().downloadSelected(paneId))}
      />
      {entryId ? (
        <>
          <div className="context-menu-separator" />
          <ContextMenuItem
            icon={<AppWindow size={17} />}
            label="Open With..."
            disabled={!targetCanOpenWith}
            disabledReason="Open With is available for files."
            onRun={() => run(() => void useExplorerStore.getState().openWithSelected(paneId))}
          />
          <ContextMenuItem
            icon={<Pin size={17} />}
            label={targetPinned ? "Unpin from Quick access" : "Pin to Quick access"}
            disabled={!targetEntry || targetEntry.isDeleted || targetEntry.kind !== "folder"}
            disabledReason="Only folders can be pinned."
            onRun={() => run(() => targetEntry && useExplorerStore.getState().togglePinnedPath(targetEntry.path))}
          />
          <div className="context-menu-separator" />
          <ContextMenuItem
            icon={<Copy size={17} />}
            label="Copy Path"
            shortcut={shortcut(`${primaryShortcut}+Alt+C`)}
            disabled={!targetEntry}
            disabledReason="Choose an item first."
            onRun={() => run(() => targetEntry && void useExplorerStore.getState().copyPath(targetEntry.path))}
          />
        </>
      ) : (
        <>
          <div className="context-menu-separator" />
          <ContextMenuItem
            icon={<Eye size={17} />}
            label={showHidden ? "Hide Hidden Files" : "Show Hidden Files"}
            shortcut={shortcut(`${primaryShortcut}+Shift+.`)}
            onRun={() => run(() => void useExplorerStore.getState().toggleHidden(paneId))}
          />
        </>
      )}
      <div className="context-menu-separator" />
      <ContextMenuItem
        icon={<RefreshCcw size={17} />}
        label="Refresh"
        shortcut={shortcut(`${primaryShortcut}+R`)}
        onRun={() => run(() => void useExplorerStore.getState().refreshPane(paneId))}
      />
    </div>,
    document.body,
  );
});

function ContextMenuItem(props: {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  disabledReason?: string;
  onRun: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={props.disabled}
      title={props.disabled ? props.disabledReason : undefined}
      onClick={props.onRun}
    >
      <span className="context-menu-icon">{props.icon}</span>
      <span className="context-menu-label">{props.label}</span>
      {props.shortcut ? <span className="context-menu-shortcut">{props.shortcut}</span> : null}
    </button>
  );
}

function primaryShortcutLabel(): string {
  if (typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform)) return "Cmd";
  return "Ctrl";
}

function selectedActionableEntryCount(pane: ReturnType<typeof useExplorerStore.getState>["panes"][string] | undefined): number {
  if (!pane?.listing) return 0;
  const selected = new Set(pane.selectedIds);
  return pane.listing.entries.filter((entry) => selected.has(entry.id) && !entry.isDeleted).length;
}

function selectedRemoteEntryCount(pane: ReturnType<typeof useExplorerStore.getState>["panes"][string] | undefined): number {
  if (!pane?.listing) return 0;
  const selected = new Set(pane.selectedIds);
  return pane.listing.entries.filter((entry) =>
    selected.has(entry.id) && !entry.isDeleted && entry.location.kind === "remote"
  ).length;
}

function ExplorerBottomBar(props: {
  sidebarVisible: boolean;
  previewVisible: boolean;
  onToggleSidebar: () => void;
  onTogglePreview: () => void;
}) {
  return (
    <footer className="explorer-bottom-bar">
      <button
        type="button"
        className={props.sidebarVisible ? "selected" : ""}
        title={props.sidebarVisible ? "Hide sidebar" : "Show sidebar"}
        onClick={props.onToggleSidebar}
      >
        <PanelLeft size={15} />
      </button>
      <button
        type="button"
        className={props.previewVisible ? "selected" : ""}
        title={props.previewVisible ? "Hide preview" : "Show preview"}
        onClick={props.onTogglePreview}
      >
        <PanelRight size={15} />
      </button>
    </footer>
  );
}

function endpointFromExplorerPath(path: string, mountRoot: string): FileSyncEndpoint {
  const cleanPath = normalizedPath(path);
  const cleanMount = normalizedPath(mountRoot);
  if (cleanPath === cleanMount || cleanPath.startsWith(`${cleanMount}/`)) {
    const parts = cleanPath.slice(cleanMount.length).split("/").filter(Boolean);
    if (parts.length >= 2) {
      return {
        kind: "remote",
        providerType: parts[0],
        remoteName: parts[1],
        remotePath: parts.length > 2 ? `/${parts.slice(2).join("/")}` : "/",
        localPath: "",
      };
    }
  }
  return { kind: "local", localPath: path, remoteName: "", remotePath: "", providerType: "" };
}

function explorerPathFromEndpoint(endpoint: FileSyncEndpoint, mountRoot: string): string {
  if (endpoint.kind === "local") return endpoint.localPath;
  const suffix = endpoint.remotePath.replace(/^\/+/, "");
  return [normalizedPath(mountRoot), endpoint.providerType, endpoint.remoteName, suffix]
    .filter(Boolean)
    .join("/");
}

function compareCounts(rows: Array<{ disposition: string }>): Record<string, number> {
  const counts: Record<string, number> = {
    left_only: 0,
    right_only: 0,
    different: 0,
    same: 0,
    conflict: 0,
  };
  for (const row of rows) counts[row.disposition] = (counts[row.disposition] ?? 0) + 1;
  return counts;
}

function compareSideSummary(side: FileSyncCompareSide): string {
  if (!side.present) return "--";
  const suffix = side.lastModified ? ` - ${side.lastModified}` : "";
  if (side.isDir) return `Folder${suffix}`;
  const size = side.size > 0 ? formatBytes(side.size) : "-";
  return `${size}${suffix}`;
}

function compareSideTitle(side: FileSyncCompareSide): string | undefined {
  if (!side.present) return undefined;
  if (side.isRemote) return `${side.remoteName}:${side.remotePath || "/"}`;
  return side.absolutePath || undefined;
}

function buildExplorerLocationResults(
  homePath: string,
  mountRoot: string,
  pinnedPaths: string[],
  remotes: ProviderRemote[],
  library: ExplorerLibrarySnapshot | null,
  workspacePaths: string[],
): ExplorerLocationResult[] {
  const results: ExplorerLocationResult[] = [];
  const seen = new Set<string>();
  const add = (label: string, path: string, badge: string) => {
    if (!path) return;
    const key = normalizedPath(path) || "/";
    if (seen.has(key)) return;
    seen.add(key);
    results.push({
      id: `${badge}:${key}`,
      label,
      path,
      subtitle: path,
      badge,
    });
  };

  add("Home", homePath, "Quick");
  add("Desktop", joinPath(homePath, "Desktop"), "Quick");
  add("Documents", joinPath(homePath, "Documents"), "Quick");
  add("Downloads", joinPath(homePath, "Downloads"), "Quick");
  add("Projects", joinPath(homePath, "Projects"), "Quick");

  for (const path of pinnedPaths) {
    add(path.split("/").filter(Boolean).pop() || path, path, "Pinned");
  }
  for (const path of workspacePaths) {
    add(titleFromPath(path), path, "Workspace");
  }
  for (const item of library?.starredFiles ?? []) {
    add(item.name || titleFromPath(item.path), item.path, "Starred");
  }
  for (const item of library?.recentFiles ?? []) {
    add(item.name || titleFromPath(item.path), item.path, "Recent");
  }
  for (const remote of remotes) {
    add(remote.name, joinPath(mountRoot, remote.type, remote.name), remote.type);
  }

  return results;
}

function pluginCommandsEqual(left: PluginCommandEntry[], right: PluginCommandEntry[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((command, index) => {
    const other = right[index];
    return command.id === other.id
      && command.label === other.label
      && command.hint === other.hint
      && command.pluginId === other.pluginId
      && command.pluginName === other.pluginName
      && command.defaultShortcut === other.defaultShortcut
      && command.source === other.source
      && command.actionKind === other.actionKind
      && command.launcherOpenMode === other.launcherOpenMode
      && command.requiresSelectedFile === other.requiresSelectedFile
      && command.pluginDir === other.pluginDir
      && command.manifestPath === other.manifestPath
      && command.libraryPath === other.libraryPath;
  });
}

function mountedDevicesEqual(left: MountedDevice[], right: MountedDevice[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((device, index) => {
    const other = right[index];
    return device.id === other.id
      && device.name === other.name
      && device.mountPath === other.mountPath
      && device.fsType === other.fsType
      && device.isRemovable === other.isRemovable
      && device.totalBytes === other.totalBytes
      && device.freeBytes === other.freeBytes;
  });
}

function workspaceSearchPaths(tabs: MultiPanelTab[]): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  const add = (path: string) => {
    const key = normalizedPath(path) || "/";
    if (!key || seen.has(key)) return;
    seen.add(key);
    paths.push(path);
  };
  for (const tab of tabs) {
    add(tab.path);
    for (const pane of tab.panes) add(pane.path);
  }
  return paths;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveMountRoot(homePath: string, configuredPath: string): string {
  if (configuredPath.startsWith("/")) return configuredPath.replace(/\/+$/, "");
  return `${homePath.replace(/\/+$/, "")}/${configuredPath.replace(/^\/+|\/+$/g, "")}`;
}

function resolvePreferredWorkspaceRoot(preferredWorkspaceRoot: string, fallbackHomePath: string): string {
  const trimmed = preferredWorkspaceRoot.trim();
  if (!trimmed || trimmed === "~") return fallbackHomePath;
  if (trimmed.startsWith("~/")) return joinPath(fallbackHomePath, trimmed.slice(2));
  if (isAbsolutePath(trimmed)) return normalizedPath(trimmed) || fallbackHomePath;
  return joinPath(fallbackHomePath, trimmed);
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

function normalizedPath(path: string): string {
  return path.replace(/\/+$/, "");
}

function titleFromPath(path: string): string {
  if (path === "misty://recent") return "Recent";
  if (path === "misty://starred") return "Starred";
  if (path === "misty://trash") return "Trash";
  const clean = normalizedPath(path);
  return clean.split("/").filter(Boolean).pop() || clean || "Home";
}

function joinPath(...parts: string[]): string {
  const [first, ...rest] = parts;
  return [first.replace(/\/+$/, ""), ...rest.map((part) => part.replace(/^\/+|\/+$/g, ""))].join("/");
}

function multiPanelWorkspaceNeedsSave(
  state: ReturnType<typeof useMultiPanelStore.getState>,
  previous: ReturnType<typeof useMultiPanelStore.getState>,
): boolean {
  return state.tabs !== previous.tabs
    || state.activeTabId !== previous.activeTabId
    || state.closedPanes !== previous.closedPanes
    || state.nextPaneIndex !== previous.nextPaneIndex
    || state.nextTabIndex !== previous.nextTabIndex;
}

function isTauriRuntime(): boolean {
  const candidate = (window as typeof window & {
    __TAURI_INTERNALS__?: {
      metadata?: {
        currentWindow?: { label?: unknown };
        currentWebview?: { label?: unknown };
      };
      invoke?: unknown;
    };
  }).__TAURI_INTERNALS__;
  return Boolean(
    candidate?.invoke
      && candidate.metadata?.currentWindow?.label
      && candidate.metadata?.currentWebview?.label,
  );
}

function externalDropTargetAt(
  position: { x: number; y: number },
  fallbackPaneId: string,
  fallbackDestination: string,
): ExternalDropTarget | null {
  const scale = window.devicePixelRatio || 1;
  const element = document.elementFromPoint(position.x / scale, position.y / scale);
  const paneElement = element?.closest<HTMLElement>("[data-explorer-pane-id]");
  const destinationElement = element?.closest<HTMLElement>("[data-drop-destination]");
  const paneId = paneElement?.dataset.explorerPaneId ?? fallbackPaneId;
  const destination = destinationElement?.dataset.dropDestination ?? fallbackDestination;
  const kind = destinationElement?.dataset.dropKind === "folder" || destinationElement?.dataset.dropKind === "directory"
    ? destinationElement.dataset.dropKind
    : "unknown";
  if (!paneId || !destination) return null;
  return { paneId, destination, kind };
}
