import {
  AppWindow,
  Blocks,
  ChevronDown,
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
  Puzzle,
  RefreshCcw,
  Scissors,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  pluginPanelRender,
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
  PluginPanelElement,
  PluginPanelEntry,
  PluginPanelRenderResult,
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
const emptyPluginPanels: PluginPanelEntry[] = [];
const emptyMountedDevices: MountedDevice[] = [];
const emptyInspectorTags: string[] = [];

const explorerShellStyles = {
  workspaceBase:
    "relative grid h-full min-h-0 overflow-hidden grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_22px] max-[980px]:grid-cols-1 max-[720px]:h-full max-[720px]:grid-rows-[minmax(0,1fr)] max-[720px]:bg-[#070707]",
  workspaceClaudeOpen:
    "grid-cols-[minmax(0,1fr)_5px_var(--claude-panel-width,380px)] max-[980px]:grid-cols-1",
  workspaceCollapsed: "sidebar-collapsed grid-cols-[minmax(0,1fr)]",
  workspaceCollapsedClaudeOpen:
    "sidebar-collapsed grid-cols-[minmax(0,1fr)_5px_var(--claude-panel-width,380px)] max-[980px]:grid-cols-1",
  main:
    "col-start-1 row-start-1 min-h-0 min-w-0 overflow-hidden max-[980px]:row-start-1 max-[980px]:min-w-0",
  bottomBar:
    "col-span-full row-start-2 flex min-w-0 items-center justify-between border-t border-[#292929] bg-[#080808] px-2 max-[720px]:hidden",
  bottomButton:
    "grid h-5 w-[22px] place-items-center rounded border-0 bg-transparent p-0 text-[#868686] hover:bg-[#171717] hover:text-[#dddddd]",
  bottomButtonSelected: "bg-[#171717] text-[#dddddd]",
} as const;

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
  const [pluginPanels, setPluginPanels] = useState<PluginPanelEntry[]>(emptyPluginPanels);
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
  const activeSelectedPath = useExplorerStore((state) => selectedPathsForPane(state.panes[activePaneId])[0] ?? activePath);
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
          setPluginPanels((current) => pluginPanelsEqual(current, pluginSnapshot.panels) ? current : pluginSnapshot.panels);
        }
      } catch {
        if (!disposed) {
          shortcutMapRef.current = defaultExplorerShortcutMap(shortcutPreferences.keymapIndex);
          executableCommandIdsRef.current = executableShortcutCommands;
          pluginCommandsRef.current = emptyPluginCommands;
          setPluginCommands((current) => current.length === 0 ? current : emptyPluginCommands);
          setPluginPanels((current) => current.length === 0 ? current : emptyPluginPanels);
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
    (paneId: string, path: string) => {
      const pluginTab = parsePluginTabPath(path);
      if (pluginTab) {
        return (
          <ExplorerPluginTabHeader
            tab={pluginTab}
            commands={pluginCommands}
            panels={pluginPanels}
          />
        );
      }
      return (
        <ConnectedExplorerToolbar
          paneId={paneId}
          fallbackPath={path}
          locationResults={locationResults}
          pluginCommands={pluginCommands}
          onNavigateRoute={navigate}
        />
      );
    },
    [locationResults, navigate, pluginCommands, pluginPanels],
  );
  const renderPane = useCallback(
    (paneId: string, path: string) => {
      const pluginTab = parsePluginTabPath(path);
      if (pluginTab) {
        return (
          <ExplorerPluginTabContent
            tab={pluginTab}
            commands={pluginCommands}
            panels={pluginPanels}
          />
        );
      }
      return <ExplorerPane paneId={paneId} path={path} />;
    },
    [pluginCommands, pluginPanels],
  );
  const inspector = useMemo(() => (previewVisible ? <ConnectedFileInspector /> : undefined), [previewVisible]);
  const explorerSidebar = useMemo(() => (sidebarVisible ? (
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
  ) : undefined), [
    activePath,
    activeWorkspaceId,
    activeWorkspaceTitle,
    devicesLoading,
    handleCreateWorkspace,
    handleDeleteWorkspace,
    handleRenameWorkspace,
    handleSelectWorkspace,
    homePath,
    mountRoot,
    mountedDevices,
    navigateSidebar,
    pinnedPaths,
    providersLoading,
    refreshDevices,
    sidebarRemotes,
    sidebarVisible,
    workspaceEntries,
  ]);
  const renderContextHeader = useCallback(
    (tab: MultiPanelTab) => tab.mode === "compare" ? <FileSyncCompareBar tab={tab} mountRoot={mountRoot} /> : null,
    [mountRoot],
  );
  const renderTabActions = useCallback(
    () => (
      <ExplorerPluginTabMenu
        commands={pluginCommands}
        panels={pluginPanels}
        selectedPath={activeSelectedPath}
      />
    ),
    [activeSelectedPath, pluginCommands, pluginPanels],
  );

  return (
    <section
      ref={workspaceRef}
      className={cx(
        explorerShellStyles.workspaceBase,
        sidebarVisible && claudePanelOpen && explorerShellStyles.workspaceClaudeOpen,
        !sidebarVisible && !claudePanelOpen && explorerShellStyles.workspaceCollapsed,
        !sidebarVisible && claudePanelOpen && explorerShellStyles.workspaceCollapsedClaudeOpen,
      )}
      style={workspaceStyle}
    >
      <main ref={mainRef} className={explorerShellStyles.main}>
        <MultiPanelWorkspace
          className="explorer-multipanel"
          renderTabActions={renderTabActions}
          renderToolbar={renderToolbar}
          renderContextHeader={renderContextHeader}
          renderNavigationAside={explorerSidebar}
          onNavigationAsideResizeStart={startSidebarResize}
          renderAside={inspector}
          onAsideResizeStart={startPreviewResize}
          renderPane={renderPane}
        />
      </main>
      {claudePanelOpen ? (
        <>
          <div className={assistantPanelStyles.claudeResizer} onPointerDown={startClaudeResize} />
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
    <div className={cx(renameStatusStyles.root, summary.tone === "warning" && renameStatusStyles.warning)} role="status" aria-live="polite">
      <span className={renameStatusStyles.text}>{summary.text}</span>
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
    <div className={notificationStyles.stack} aria-live="polite" aria-atomic="false">
      {props.notifications.map((notification) => (
        <button
          key={notification.id}
          type="button"
          className={cx(
            notificationStyles.item,
            notification.type === "success" && notificationStyles.success,
            notification.type === "error" && notificationStyles.error,
            notification.type === "info" && notificationStyles.info,
          )}
          title={notification.message}
          onClick={() => props.onDismiss(notification.id)}
        >
          {compactNotificationMessage(notification.message)}
        </button>
      ))}
    </div>
  );
}

function ExplorerPluginTabMenu(props: {
  commands: PluginCommandEntry[];
  panels: PluginPanelEntry[];
  selectedPath: string;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const plugins = useMemo(
    () => pluginMenuItems(props.panels, props.commands, props.selectedPath),
    [props.commands, props.panels, props.selectedPath],
  );
  const visiblePlugins = useMemo(
    () => filterPluginMenuItems(plugins, query),
    [plugins, query],
  );
  const highlightedCount = plugins.filter((plugin) => plugin.usable).length;

  const updateMenuPosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const width = Math.min(380, Math.max(310, window.innerWidth - 24));
    const left = Math.min(Math.max(12, rect.right - width), Math.max(12, window.innerWidth - width - 12));
    const top = Math.min(rect.bottom + 7, Math.max(12, window.innerHeight - 120));
    setMenuStyle({
      left,
      top,
      width,
      maxHeight: `calc(100vh - ${top + 12}px)`,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
    const handlePointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

  const openPluginTab = useCallback((plugin: PluginMenuItem) => {
    const tabPath = pluginTabPathForMenuItem(plugin, props.selectedPath);
    setOpen(false);
    useMultiPanelStore.getState().addTab(tabPath, plugin.pluginName);
  }, [props.selectedPath]);

  const browsePlugins = useCallback(() => {
    setOpen(false);
    navigate("/hub/plugins");
  }, [navigate]);

  return (
    <>
      <button
        ref={buttonRef}
        className={pluginTabMenuStyles.trigger}
        type="button"
        title="Plugins"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Puzzle size={16} />
        <ChevronDown size={13} />
      </button>
      {open ? createPortal((
        <div ref={menuRef} className={pluginTabMenuStyles.menu} style={menuStyle} role="menu" aria-label="Plugins">
          <header className={pluginTabMenuStyles.header}>
            <span className={pluginTabMenuStyles.headerTitle}>
              <Puzzle size={16} />
              <strong>Plugins</strong>
            </span>
            <span className={pluginTabMenuStyles.headerMeta}>{highlightedCount} usable</span>
          </header>
          <label className={pluginTabMenuStyles.searchLabel}>
            <span className="sr-only">Search plugins</span>
            <input
              className={pluginTabMenuStyles.searchInput}
              value={query}
              placeholder="Search plugins..."
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {plugins.length > 0 ? (
            <div className={pluginTabMenuStyles.sections}>
              {visiblePlugins.map((plugin) => (
                <button
                  key={plugin.pluginId}
                  type="button"
                  className={cx(pluginTabMenuStyles.item, plugin.usable && pluginTabMenuStyles.itemUsable)}
                  role="menuitem"
                  onClick={() => openPluginTab(plugin)}
                >
                  {plugin.kind === "panel" ? <Blocks size={16} /> : <Terminal size={16} />}
                  <span className={pluginTabMenuStyles.itemText}>
                    <strong>{plugin.pluginName}</strong>
                    <small>{pluginMenuSubtitle(plugin)}</small>
                  </span>
                  <span className={cx(pluginTabMenuStyles.areaPill, plugin.usable && pluginTabMenuStyles.areaPillUsable)}>
                    {plugin.usable ? "Files" : plugin.primaryArea}
                  </span>
                </button>
              ))}
              {visiblePlugins.length === 0 ? (
                <div className={pluginTabMenuStyles.empty}>
                  <Puzzle size={20} />
                  <span>No plugins match the current search.</span>
                </div>
              ) : null}
            </div>
          ) : (
            <div className={pluginTabMenuStyles.empty}>
              <Puzzle size={20} />
              <span>No installed plugin panels or commands found.</span>
            </div>
          )}
          <button className={pluginTabMenuStyles.footerItem} type="button" role="menuitem" onClick={browsePlugins}>
            <Puzzle size={15} />
            <span>Browse plugins</span>
          </button>
        </div>
      ), document.body) : null}
    </>
  );
}

type PluginMenuItem = {
  pluginId: string;
  pluginName: string;
  panels: PluginPanelEntry[];
  commands: PluginCommandEntry[];
  usable: boolean;
  primaryArea: string;
  kind: "panel" | "commands";
};

type PluginTabState = {
  kind: "panel" | "commands";
  pluginId: string;
  panelId: string;
  selectedPath: string;
};

const pluginTabProtocol = "misty-plugin:";
const currentPluginArea = "files";

function pluginMenuItems(
  panels: PluginPanelEntry[],
  commands: PluginCommandEntry[],
  selectedPath: string,
): PluginMenuItem[] {
  const grouped = new Map<string, PluginMenuItem>();
  for (const panel of panels) {
    const item = grouped.get(panel.pluginId) ?? createPluginMenuItem(panel.pluginId, panel.pluginName);
    item.panels.push(panel);
    item.pluginName = panel.pluginName || item.pluginName;
    grouped.set(panel.pluginId, item);
  }
  for (const command of commands) {
    if (pluginCommandOnlyOpensLauncher(command)) continue;
    const item = grouped.get(command.pluginId) ?? createPluginMenuItem(command.pluginId, command.pluginName);
    item.commands.push(command);
    item.pluginName = command.pluginName || item.pluginName;
    grouped.set(command.pluginId, item);
  }

  return Array.from(grouped.values())
    .map((item) => {
      const usablePanels = item.panels.filter(pluginPanelUsableInCurrentArea);
      const usableCommands = item.commands.filter((command) => !pluginCommandNeedsSelection(command, selectedPath));
      const primaryPanel = usablePanels[0] ?? item.panels[0];
      const primaryArea = primaryPanel?.launcherViews[0] ?? "Other";
      return {
        ...item,
        panels: item.panels.slice().sort((left, right) => left.title.localeCompare(right.title)),
        commands: item.commands.slice().sort((left, right) => left.label.localeCompare(right.label)),
        usable: usablePanels.length > 0 || usableCommands.length > 0,
        primaryArea,
        kind: primaryPanel ? "panel" as const : "commands" as const,
      };
    })
    .sort((left, right) => Number(right.usable) - Number(left.usable) || left.pluginName.localeCompare(right.pluginName));
}

function createPluginMenuItem(pluginId: string, pluginName: string): PluginMenuItem {
  return {
    pluginId,
    pluginName: pluginName || pluginId,
    panels: [],
    commands: [],
    usable: false,
    primaryArea: "Other",
    kind: "commands",
  };
}

function filterPluginMenuItems(items: PluginMenuItem[], query: string): PluginMenuItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) =>
    [
      item.pluginId,
      item.pluginName,
      item.primaryArea,
      ...item.panels.flatMap((panel) => [panel.id, panel.title, panel.launcherViews.join(" ")]),
      ...item.commands.flatMap((command) => [command.id, command.label, command.hint]),
    ].join(" ").toLowerCase().includes(needle)
  );
}

function pluginPanelUsableInCurrentArea(panel: PluginPanelEntry): boolean {
  if (panel.launcherViews.length === 0) return true;
  return panel.launcherViews.some((view) => normalizedPluginArea(view) === currentPluginArea);
}

function normalizedPluginArea(area: string): string {
  const normalized = area.trim().toLowerCase();
  if (normalized === "explorer") return "files";
  return normalized;
}

function pluginMenuSubtitle(plugin: PluginMenuItem): string {
  const panelCount = plugin.panels.length;
  const commandCount = plugin.commands.length;
  if (panelCount && commandCount) return `${panelCount} panel${panelCount === 1 ? "" : "s"} · ${commandCount} command${commandCount === 1 ? "" : "s"}`;
  if (panelCount) return `${panelCount} panel${panelCount === 1 ? "" : "s"}`;
  return `${commandCount} command${commandCount === 1 ? "" : "s"}`;
}

function pluginTabPathForMenuItem(plugin: PluginMenuItem, selectedPath: string): string {
  const usablePanel = plugin.panels.find(pluginPanelUsableInCurrentArea);
  const panel = usablePanel ?? plugin.panels[0];
  const params = new URLSearchParams({ plugin: plugin.pluginId });
  if (selectedPath.trim()) params.set("selected", selectedPath);
  if (panel) {
    params.set("panel", panel.id);
    return `${pluginTabProtocol}//panel?${params.toString()}`;
  }
  return `${pluginTabProtocol}//commands?${params.toString()}`;
}

function parsePluginTabPath(path: string): PluginTabState | null {
  if (!path.startsWith(pluginTabProtocol)) return null;
  try {
    const url = new URL(path);
    const pluginId = url.searchParams.get("plugin") ?? "";
    if (!pluginId) return null;
    return {
      kind: url.hostname === "commands" ? "commands" : "panel",
      pluginId,
      panelId: url.searchParams.get("panel") ?? "",
      selectedPath: url.searchParams.get("selected") ?? "",
    };
  } catch {
    return null;
  }
}

function ExplorerPluginTabHeader(props: {
  tab: PluginTabState;
  commands: PluginCommandEntry[];
  panels: PluginPanelEntry[];
}) {
  const plugin = pluginMenuItems(props.panels, props.commands, props.tab.selectedPath)
    .find((item) => item.pluginId === props.tab.pluginId);
  const title = plugin?.pluginName ?? props.tab.pluginId;
  return (
    <div className={pluginTabHostStyles.header}>
      <div className={pluginTabHostStyles.headerTitle}>
        <Puzzle size={18} />
        <div>
          <strong>{title}</strong>
          <span>{plugin ? pluginMenuSubtitle(plugin) : "Plugin"}</span>
        </div>
      </div>
      {plugin ? (
        <span className={cx(pluginTabHostStyles.statusPill, plugin.usable && pluginTabHostStyles.statusPillUsable)}>
          {plugin.usable ? "Usable in Files" : `Area: ${plugin.primaryArea}`}
        </span>
      ) : null}
    </div>
  );
}

function ExplorerPluginTabContent(props: {
  tab: PluginTabState;
  commands: PluginCommandEntry[];
  panels: PluginPanelEntry[];
}) {
  const [runningCommandId, setRunningCommandId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const pluginPanels = props.panels.filter((panel) => panel.pluginId === props.tab.pluginId);
  const panel = props.tab.kind === "panel"
    ? pluginPanels.find((candidate) => candidate.id === props.tab.panelId) ?? pluginPanels[0]
    : null;
  const commands = props.commands.filter((command) =>
    command.pluginId === props.tab.pluginId && !pluginCommandOnlyOpensLauncher(command)
  );

  const runCommand = useCallback((command: PluginCommandEntry) => {
    if (pluginCommandNeedsSelection(command, props.tab.selectedPath)) {
      setError(`${command.label}: Select a file before running this command.`);
      return;
    }
    setRunningCommandId(command.id);
    setError("");
    setMessage("");
    void pluginCommandRun({
      commandId: command.id,
      selectedPaths: props.tab.selectedPath ? [props.tab.selectedPath] : [],
    })
      .then((result) => {
        publishPluginNotifications(result.notifications, result.message);
        if (result.handled) setMessage(result.message);
        else setError(`${result.label}: ${result.message}`);
      })
      .catch((error) => setError(errorText(error)))
      .finally(() => setRunningCommandId(null));
  }, [props.tab.selectedPath]);

  if (!panel && commands.length === 0) {
    return (
      <div className={pluginTabHostStyles.empty}>
        <Puzzle size={26} />
        <h3>Plugin unavailable</h3>
        <p>This plugin no longer exposes panels or commands.</p>
      </div>
    );
  }

  return (
    <div className={pluginTabHostStyles.body}>
      {error ? <div className={pluginTabHostStyles.error}>{error}</div> : null}
      {message ? <div className={pluginTabHostStyles.message}>{message}</div> : null}
      {panel ? (
        <ExplorerPluginPanelHost
          panel={panel}
          selectedPath={props.tab.selectedPath}
        />
      ) : null}
      {commands.length > 0 ? (
        <section className={pluginTabHostStyles.commands}>
          <h3>Commands</h3>
          {commands.map((command) => (
            <div key={command.id} className={pluginTabHostStyles.commandRow}>
              <span className={pluginTabHostStyles.commandLabel} title={command.hint}>
                {command.label}
              </span>
              <small>{command.defaultShortcut || command.source}</small>
              {pluginCommandNeedsSelection(command, props.tab.selectedPath) ? (
                <em>Select a file first</em>
              ) : null}
              <button
                className={pluginTabHostStyles.button}
                type="button"
                disabled={runningCommandId === command.id || pluginCommandNeedsSelection(command, props.tab.selectedPath)}
                onClick={() => runCommand(command)}
              >
                <Terminal size={13} />
                {runningCommandId === command.id ? "Running" : "Run"}
              </button>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function ExplorerPluginPanelHost(props: {
  panel: PluginPanelEntry;
  selectedPath: string;
}) {
  const [rendered, setRendered] = useState<PluginPanelRenderResult | null>(null);
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState("");
  const [inputs, setInputs] = useState<Record<string, string>>({});

  const renderPanel = useCallback((clickedButton = "") => {
    setRendering(true);
    setRenderError("");
    void pluginPanelRender({
      panelId: props.panel.id,
      pluginId: props.panel.pluginId,
      selectedPaths: props.selectedPath ? [props.selectedPath] : [],
      clickedButton,
      inputs,
    })
      .then((result) => {
        setRendered(result);
        publishPluginNotifications(result.notifications);
      })
      .catch((error) => setRenderError(errorText(error)))
      .finally(() => setRendering(false));
  }, [inputs, props.panel.id, props.panel.pluginId, props.selectedPath]);

  useEffect(() => {
    setInputs({});
    setRendered(null);
    setRenderError("");
    setRendering(true);
    void pluginPanelRender({
      panelId: props.panel.id,
      pluginId: props.panel.pluginId,
      selectedPaths: props.selectedPath ? [props.selectedPath] : [],
    })
      .then((result) => {
        setRendered(result);
        publishPluginNotifications(result.notifications);
      })
      .catch((error) => setRenderError(errorText(error)))
      .finally(() => setRendering(false));
  }, [props.panel.id, props.panel.pluginId, props.selectedPath]);

  return (
    <section className={pluginTabHostStyles.panel}>
      <header className={pluginTabHostStyles.panelHeader}>
        <div>
          <h3>{rendered?.title ?? props.panel.title}</h3>
          <span>{props.panel.pluginName}</span>
        </div>
        <button className={pluginTabHostStyles.button} type="button" onClick={() => renderPanel()} disabled={rendering}>
          <RefreshCcw size={13} />
          Refresh
        </button>
      </header>
      {renderError ? <div className={pluginTabHostStyles.error}>{renderError}</div> : null}
      {rendered && rendered.runtimeStatus !== "native_rendered" ? (
        <div className={pluginTabHostStyles.notice}>
          <Puzzle size={20} />
          <span>{rendered.message || "Plugin panel unavailable."}</span>
        </div>
      ) : null}
      {!rendered && !renderError ? <div className={pluginTabHostStyles.loading}>Loading plugin panel...</div> : null}
      {rendered?.runtimeStatus === "native_rendered" ? (
        <div className={pluginTabHostStyles.elements}>
          {rendered.elements.map((element) => (
            <PluginPanelElementView
              key={element.id}
              element={element}
              value={inputs[element.id] ?? ""}
              disabled={rendering}
              onInput={(value) => setInputs((current) => ({ ...current, [element.id]: value }))}
              onButton={() => renderPanel(element.id)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function PluginPanelElementView(props: {
  element: PluginPanelElement;
  value: string;
  disabled: boolean;
  onInput: (value: string) => void;
  onButton: () => void;
}) {
  if (props.element.kind === "button") {
    return (
      <button className={pluginTabHostStyles.button} type="button" disabled={props.disabled} onClick={props.onButton}>
        {props.element.text || props.element.id}
      </button>
    );
  }
  if (props.element.kind === "input") {
    return (
      <input
        className={pluginTabHostStyles.input}
        value={props.value}
        disabled={props.disabled}
        placeholder={props.element.text}
        onChange={(event) => props.onInput(event.target.value)}
      />
    );
  }
  if (props.element.kind === "separator") return <hr className={pluginTabHostStyles.separator} />;
  if (props.element.kind === "spacing") return <span className={pluginTabHostStyles.spacing} aria-hidden="true" />;
  if (props.element.kind === "image") return <div className={pluginTabHostStyles.image}>Texture {props.element.id}</div>;
  return <p className={pluginTabHostStyles.text}>{props.element.text}</p>;
}

function compactNotificationMessage(message: string): string {
  const normalized = message.replace(/\s+/g, " ").trim();
  return normalized.length <= 64 ? normalized : `${normalized.slice(0, 61)}...`;
}

function pluginCommandOnlyOpensLauncher(command: PluginCommandEntry): boolean {
  if (command.source === "launcher" || command.actionKind === "open") return true;
  const label = command.label.trim();
  return label === "Open" || label.endsWith(": Open");
}

function pluginCommandNeedsSelection(command: PluginCommandEntry, selectedPath: string): boolean {
  return command.requiresSelectedFile && !selectedPath.trim();
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

const renameStatusStyles = {
  root:
    "pointer-events-none absolute bottom-[34px] left-1/2 z-[28] flex min-h-[30px] max-w-[min(520px,calc(100%_-_96px))] -translate-x-1/2 items-center justify-center rounded-lg border border-[rgba(152, 152, 152, 0.48)] bg-[rgba(71, 71, 71, 0.94)] px-3.5 py-1.5 text-[#f1f1f1] shadow-[0_12px_28px_rgba(0,0,0,0.32)]",
  warning: "border-[rgba(134, 134, 134, 0.55)] bg-[rgba(64, 64, 64, 0.96)]",
  text: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-medium",
} as const;

const notificationStyles = {
  stack:
    "pointer-events-none absolute left-1/2 top-[58px] z-30 grid w-[min(360px,calc(100%_-_48px))] -translate-x-1/2 justify-items-center gap-2",
  item:
    "pointer-events-auto min-h-8 max-w-full overflow-hidden text-ellipsis whitespace-nowrap rounded-[10px] border border-[#525252] bg-[rgba(30, 30, 30, 0.96)] px-[13px] py-[7px] text-[#eeeeee] shadow-[0_14px_32px_rgba(0,0,0,0.35)]",
  success: "border-[rgba(120, 120, 120, 0.9)] bg-[rgba(49, 49, 49, 0.96)]",
  error: "border-[rgba(92, 92, 92, 0.9)] bg-[rgba(38, 38, 38, 0.96)]",
  info: "border-[rgba(82, 82, 82, 0.9)]",
} as const;

const pluginTabMenuStyles = {
  trigger:
    "grid h-[26px] w-[34px] grid-cols-[1fr_auto] items-center justify-center gap-px rounded-md border-0 bg-transparent px-[7px] text-[#adadad] hover:bg-[#1d1d1d] hover:text-[#eeeeee] aria-expanded:bg-[#1d1d1d] aria-expanded:text-[#eeeeee] max-[720px]:h-7 max-[720px]:w-[38px]",
  menu:
    "fixed z-[2147483000] grid overflow-auto rounded-[11px] border border-[#323232] bg-[rgba(17,17,17,0.98)] p-1.5 text-[#eeeeee] shadow-[0_18px_42px_rgba(0,0,0,0.48)] backdrop-blur-xl",
  header:
    "flex h-9 items-center justify-between gap-2 border-b border-[#292929] px-2.5 text-sm",
  headerTitle: "flex min-w-0 items-center gap-2",
  headerMeta: "text-xs font-semibold text-[#8f8f8f]",
  searchLabel: "block px-1.5 py-2",
  searchInput:
    "h-8 w-full rounded-lg border border-[#303030] bg-[#0c0c0c] px-2.5 text-[13px] text-[#eeeeee] outline-none placeholder:text-[#777777] focus:border-[#686868]",
  sections: "grid gap-1 py-1",
  section: "grid gap-0.5",
  sectionLabel:
    "px-2.5 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-normal text-[#8f8f8f]",
  item:
    "grid min-h-11 w-full grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-transparent bg-transparent px-2.5 py-2 text-left text-[#a8a8a8] hover:bg-[#222222] hover:text-[#f7f7f7]",
  itemUsable:
    "border-[#3d3d3d] bg-[#1a1a1a] text-[#eeeeee]",
  itemText:
    "grid min-w-0 gap-0.5 [&>small]:min-w-0 [&>small]:overflow-hidden [&>small]:text-ellipsis [&>small]:whitespace-nowrap [&>small]:text-xs [&>small]:font-medium [&>small]:text-[#9f9f9f] [&>strong]:min-w-0 [&>strong]:overflow-hidden [&>strong]:text-ellipsis [&>strong]:whitespace-nowrap [&>strong]:text-[13px]",
  areaPill:
    "rounded-full border border-[#303030] px-2 py-1 text-[10px] font-semibold text-[#8f8f8f]",
  areaPillUsable:
    "border-[#5a5a5a] bg-[#2a2a2a] text-[#eeeeee]",
  empty:
    "grid justify-items-center gap-2 px-4 py-5 text-center text-xs text-[#adadad]",
  footerItem:
    "mt-1 flex h-9 w-full items-center gap-2 rounded-lg border-0 border-t border-[#292929] bg-transparent px-2.5 text-left text-xs font-semibold text-[#cfcfcf] hover:bg-[#222222] hover:text-[#f7f7f7]",
} as const;

const pluginTabHostStyles = {
  header:
    "flex min-h-[92px] items-center justify-between gap-4 border-b border-[#292929] bg-[#101010] px-4 py-3",
  headerTitle: "flex min-w-0 items-center gap-3 [&_strong]:block [&_strong]:truncate [&_strong]:text-[15px] [&_span]:mt-1 [&_span]:block [&_span]:truncate [&_span]:text-xs [&_span]:text-[#9f9f9f]",
  statusPill:
    "shrink-0 rounded-full border border-[#363636] px-2.5 py-1.5 text-xs font-semibold text-[#9f9f9f]",
  statusPillUsable: "border-[#565656] bg-[#242424] text-[#eeeeee]",
  body:
    "grid min-h-full content-start gap-3 overflow-auto bg-[#111111] p-4 text-[#eeeeee]",
  panel:
    "grid gap-3 rounded-lg border border-[#303030] bg-[#151515] p-3.5",
  panelHeader:
    "flex items-center justify-between gap-3 [&_h3]:m-0 [&_h3]:text-[15px] [&_span]:mt-1 [&_span]:block [&_span]:text-xs [&_span]:text-[#9f9f9f]",
  button:
    "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-[7px] border border-[#3a3a3a] bg-[#242424] px-2.5 py-1.5 text-xs font-semibold text-[#eeeeee] disabled:cursor-progress disabled:opacity-60",
  input:
    "min-h-9 min-w-[min(280px,100%)] rounded-[7px] border border-[#3a3a3a] bg-[#0d0d0d] px-2.5 text-[#eeeeee] outline-none focus:border-[#686868] disabled:opacity-60",
  elements: "flex min-h-20 flex-wrap items-center gap-2.5",
  text: "m-0 basis-full text-sm leading-[1.45] text-[#dddddd]",
  separator: "my-1 w-full basis-full border-0 border-t border-[#303030]",
  spacing: "h-2 basis-full",
  image:
    "grid min-h-12 min-w-20 place-items-center rounded-[7px] border border-[#303030] bg-[#0d0d0d] text-xs text-[#9f9f9f]",
  loading:
    "rounded-lg border border-[#303030] bg-[#101010] px-3 py-2.5 text-sm text-[#9f9f9f]",
  notice:
    "grid grid-cols-[24px_minmax(0,1fr)] items-center gap-2 rounded-lg border border-[#3a3a3a] bg-[#111111] px-3 py-2.5 text-sm text-[#cfcfcf]",
  error:
    "rounded-lg border border-[#4b3434] bg-[#211414] px-3 py-2.5 text-sm text-[#ffb7b7]",
  message:
    "rounded-lg border border-[#354835] bg-[#142014] px-3 py-2.5 text-sm text-[#bcecbc]",
  commands:
    "grid gap-2 rounded-lg border border-[#303030] bg-[#151515] p-3.5 [&_h3]:m-0 [&_h3]:text-[15px]",
  commandRow:
    "grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 border-t border-[#303030] pt-2 first:border-t-0 first:pt-0 [&_em]:whitespace-nowrap [&_em]:text-xs [&_em]:not-italic [&_em]:text-[#cfcfcf] [&_small]:text-[#8f8f8f]",
  commandLabel: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm",
  empty:
    "grid min-h-full content-center justify-items-center gap-2 bg-[#111111] p-6 text-center text-[#9f9f9f] [&_h3]:m-0 [&_h3]:text-[#eeeeee] [&_p]:m-0",
} as const;

const dialogStyles = {
  backdrop: "fixed inset-0 z-[2147483200] grid place-items-center bg-[rgba(6, 6, 6, 0.58)] p-6 backdrop-blur-[3px]",
  dialog: "grid w-[min(380px,100%)] gap-4 rounded-[10px] border border-[#353535] bg-[#141414] p-[18px] shadow-[0_24px_64px_rgba(0,0,0,0.55)]",
  wide: "max-h-[min(620px,calc(100vh-48px))] w-[min(720px,100%)] grid-rows-[auto_auto_minmax(0,1fr)_auto]",
  title: "m-0 text-[17px] font-semibold",
  text: "m-0 leading-normal text-[#b2b2b2]",
  actions: "flex justify-end gap-2",
  actionButton: "h-[34px] min-w-[82px] rounded-[7px]",
  danger: "border-[#484848] bg-[#313131] text-[#f4f4f4]",
  input: "h-[38px] w-full rounded-[7px] border border-[#3f3f3f] bg-[#0e0e0e] px-[11px] text-[#f0f0f0] outline-none focus:border-[#787878] focus:shadow-[0_0_0_2px_rgba(120,120,120,0.18)]",
  batchHeader: "flex items-start justify-between gap-4",
  batchBadge: "flex-none rounded-full border border-[#4a4a4a] bg-[rgba(49, 49, 49, 0.52)] px-[9px] py-1 text-xs text-[#c6c6c6]",
  batchHead: "grid grid-cols-[minmax(140px,0.85fr)_minmax(220px,1.25fr)] gap-3 rounded-t-lg border border-b-0 border-[#292929] bg-[#171717] px-2.5 py-2 text-xs font-semibold uppercase text-[#b2b2b2] max-[640px]:grid-cols-1 max-[640px]:gap-1.5",
  batchList: "grid max-h-[min(320px,48vh)] gap-0 overflow-auto rounded-b-lg border border-t-0 border-[#292929] bg-[#101010]",
  batchRow: "grid grid-cols-[minmax(140px,0.85fr)_minmax(220px,1.25fr)] items-start gap-3 border-b border-[#292929] bg-[#101010] px-2.5 py-2 last:border-b-0 max-[640px]:grid-cols-1 max-[640px]:gap-1.5",
  batchRowInvalid: "bg-[#0e0e0e]",
  batchBefore: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap leading-[38px] text-[#cacaca] max-[640px]:leading-snug",
  batchInputWrap: "flex min-w-0 items-center rounded-[7px] border border-[#3f3f3f] bg-[#0e0e0e] focus-within:border-[#787878] focus-within:shadow-[0_0_0_2px_rgba(120,120,120,0.18)]",
  batchInput: "h-[34px] border-0 bg-transparent shadow-none",
  batchExtension: "max-w-[120px] flex-none overflow-hidden text-ellipsis whitespace-nowrap py-0 pl-0 pr-2.5 text-[#8f8f8f]",
  batchError: "mt-[5px] block text-xs not-italic text-[#c6c6c6]",
  batchMuted: "text-[#979797]",
  batchReady: "text-[#adadad]",
} as const;

const contextMenuStyles = {
  menu: "fixed z-[1000] w-[250px] overflow-auto rounded-[11px] border border-[#323232] bg-[rgba(17, 17, 17, 0.97)] p-1.5 shadow-[0_18px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl",
  item:
    "grid h-9 w-full grid-cols-[19px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg border-0 bg-transparent px-2.5 text-left text-[#dddddd] hover:not-disabled:bg-[#222222] hover:not-disabled:text-[#eeeeee] disabled:opacity-45 [&:hover:not(:disabled)_.context-menu-icon]:text-[#d0d0d0] [&:hover:not(:disabled)_.context-menu-shortcut]:text-[#d0d0d0]",
  icon: "context-menu-icon inline-flex items-center justify-center text-[#b6b6b6]",
  label: "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
  shortcut: "context-menu-shortcut text-xs text-[#898989]",
  separator: "mx-1 my-[5px] h-px bg-[#292929]",
} as const;

const contextMenuViewportMargin = 8;

function useViewportAnchoredMenu(open: boolean, x: number, y: number) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<CSSProperties>(() => ({
    left: x,
    top: y,
    visibility: "hidden",
  }));

  const updatePosition = useCallback(() => {
    if (!open) return;
    const menu = menuRef.current;
    if (!menu) return;
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const rect = menu.getBoundingClientRect();
    const minLeft = viewportLeft + contextMenuViewportMargin;
    const minTop = viewportTop + contextMenuViewportMargin;
    const maxLeft = Math.max(minLeft, viewportLeft + viewportWidth - rect.width - contextMenuViewportMargin);
    const maxTop = Math.max(minTop, viewportTop + viewportHeight - rect.height - contextMenuViewportMargin);
    const nextLeft = Math.min(Math.max(x, minLeft), maxLeft);
    const nextTop = Math.min(Math.max(y, minTop), maxTop);
    const maxHeight = Math.max(120, viewportHeight - contextMenuViewportMargin * 2);

    setStyle((current) => {
      if (
        current.left === nextLeft &&
        current.top === nextTop &&
        current.maxHeight === maxHeight &&
        current.visibility === "visible"
      ) {
        return current;
      }
      return { left: nextLeft, top: nextTop, maxHeight, visibility: "visible" };
    });
  }, [open, x, y]);

  useLayoutEffect(() => {
    if (!open) {
      setStyle({ left: x, top: y, visibility: "hidden" });
      return;
    }
    setStyle({ left: x, top: y, visibility: "hidden" });
    updatePosition();
  }, [open, updatePosition, x, y]);

  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    if (!menu) return;
    const resizeObserver = new ResizeObserver(updatePosition);
    resizeObserver.observe(menu);
    window.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("scroll", updatePosition);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("scroll", updatePosition);
    };
  }, [open, updatePosition]);

  return { menuRef, style };
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
      <div className={dialogStyles.backdrop} role="presentation">
        <form
          className={cx(dialogStyles.dialog, dialogStyles.wide)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="explorer-dialog-title"
          onPointerDown={(event) => event.stopPropagation()}
          onSubmit={(event) => {
            event.preventDefault();
            void useExplorerStore.getState().confirmDialog();
          }}
        >
          <header className={dialogStyles.batchHeader}>
            <div>
              <h2 className={dialogStyles.title} id="explorer-dialog-title">Review Renames</h2>
              <p className={dialogStyles.text}>{readyCount} ready, {unchangedCount} unchanged, {invalidCount} need fixes.</p>
            </div>
            {invalidCount > 0 ? <span className={dialogStyles.batchBadge}>{invalidCount} need fixes</span> : null}
          </header>
          <div className={dialogStyles.batchHead} aria-hidden="true">
            <span>Before</span>
            <span>After</span>
          </div>
          <div className={dialogStyles.batchList}>
            {dialog.items.map((item, index) => (
              <label className={cx(dialogStyles.batchRow, item.error && dialogStyles.batchRowInvalid)} key={`${item.paneId}:${item.entryId}`}>
                <span className={dialogStyles.batchBefore} title={item.originalName}>{item.originalName}</span>
                <div>
                  <div className={dialogStyles.batchInputWrap}>
                    <input
                      className={cx(dialogStyles.input, dialogStyles.batchInput)}
                      value={item.value}
                      autoComplete="off"
                      autoFocus={invalidCount > 0 ? index === firstInvalidIndex : index === 0}
                      aria-invalid={Boolean(item.error)}
                      onChange={(event) => useExplorerStore.getState().setBatchRenameValue(item.paneId, item.entryId, event.target.value)}
                    />
                    {item.lockedExtension ? <small className={dialogStyles.batchExtension}>{item.lockedExtension}</small> : null}
                  </div>
                  {item.error ? <em className={dialogStyles.batchError}>{item.error}</em> : (
                    <em className={cx(
                      dialogStyles.batchError,
                      `${item.value.trim()}${item.lockedExtension}` === item.originalName ? dialogStyles.batchMuted : dialogStyles.batchReady,
                    )}>
                      {`${item.value.trim()}${item.lockedExtension}` === item.originalName ? "Unchanged" : "Ready"}
                    </em>
                  )}
                </div>
              </label>
            ))}
          </div>
          <div className={dialogStyles.actions}>
            <button className={dialogStyles.actionButton} type="button" onClick={() => useExplorerStore.getState().closeDialog()}>Cancel</button>
            <button className={dialogStyles.actionButton} type="submit" disabled={readyCount === 0}>Confirm</button>
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
    <div className={dialogStyles.backdrop} role="presentation">
      <form
        className={dialogStyles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="explorer-dialog-title"
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void useExplorerStore.getState().confirmDialog();
        }}
      >
        <h2 className={dialogStyles.title} id="explorer-dialog-title">Delete Permanently</h2>
        <p className={dialogStyles.text}>Delete <strong>{deleteLabel}</strong>? This cannot be undone.</p>
        <div className={dialogStyles.actions}>
          <button className={dialogStyles.actionButton} type="button" onClick={() => useExplorerStore.getState().closeDialog()}>Cancel</button>
          <button type="submit" className={cx(dialogStyles.actionButton, dialogStyles.danger)}>Delete</button>
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

const compareStyles = {
  strip: "min-w-0 border-b border-[#292929] bg-[#111111] px-3 py-[7px] text-[#dddddd]",
  main: "flex min-w-0 items-center gap-[7px] overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
  title: "mr-[3px] flex min-w-0 flex-none items-center gap-[7px]",
  status: "rounded-full px-[7px] py-[3px] text-[11px]",
  statusReady: "bg-[#313131] text-[#b8b8b8]",
  statusStale: "bg-[#313131] text-[#c6c6c6]",
  statusWorking: "bg-[#2d2d2d] text-[#c4c4c4]",
  control: "h-[30px] flex-none rounded-[7px] border border-[#333333] bg-[#181818] px-[9px] text-[#dddddd]",
  select: "w-[170px]",
  input: "w-[180px]",
  primary: "border-[#626262] bg-[#545454] text-white",
  watch: "flex min-w-0 flex-none grid-flow-col items-center gap-[5px] normal-case text-[#b4b4b4]",
  checkbox: "h-[15px] w-[15px]",
  summary: "mt-1.5 flex min-w-0 items-center gap-[13px] overflow-x-auto whitespace-nowrap text-[11px] text-[#979797] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
  error: "text-[#9b9b9b]",
  success: "text-[#b8b8b8]",
  results: "mt-1.5 border-t border-[#292929] pt-1.5",
  resultsSummary: "cursor-pointer text-xs text-[#b4b4b4]",
  resultsScroll:
    "mt-1.5 max-h-[210px] overflow-auto [&_select]:h-[27px] [&_select]:rounded-md [&_select]:border [&_select]:border-[#333333] [&_select]:bg-[#181818] [&_select]:text-[#dddddd] [&_table]:w-full [&_table]:min-w-[620px] [&_table]:border-collapse [&_table]:text-xs [&_td]:border-b [&_td]:border-[#262626] [&_td]:px-2 [&_td]:py-[5px] [&_td]:text-left [&_th]:border-b [&_th]:border-[#262626] [&_th]:px-2 [&_th]:py-[5px] [&_th]:text-left",
} as const;

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

  if (!session) return <div className={compareStyles.strip}><span>Preparing compare workspace...</span></div>;
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
    <section className={compareStyles.strip}>
      <div className={compareStyles.main}>
        <div className={compareStyles.title}>
          <GitCompareArrows size={17} />
          <strong>Compare</strong>
          <span className={cx(
            compareStyles.status,
            session.comparing ? compareStyles.statusWorking : session.stale ? compareStyles.statusStale : compareStyles.statusReady,
          )}>
            {session.comparing ? "Comparing..." : session.stale ? "Needs review" : "Ready"}
          </span>
        </div>
        <select
          className={cx(compareStyles.control, compareStyles.select)}
          aria-label="Saved sync pair"
          value={session.activePairId ?? ""}
          disabled={loadingPairs}
          onChange={(event) => event.target.value && navigateToPair(Number(event.target.value))}
        >
          <option value="">Saved pairs</option>
          {pairs.map((pair) => <option key={pair.id} value={pair.id}>{pair.name}</option>)}
        </select>
        <input
          className={cx(compareStyles.control, compareStyles.input)}
          aria-label="Sync pair name"
          value={session.pairName}
          placeholder="Saved pair name"
          onChange={(event) => useFileSyncStore.getState().setPairName(props.tab.id, event.target.value)}
        />
        <button className={compareStyles.control} type="button" onClick={() => void useFileSyncStore.getState().savePair(props.tab.id)}>Save Pair</button>
        <label className={compareStyles.watch}>
          <input
            className={compareStyles.checkbox}
            type="checkbox"
            checked={session.watchMode}
            onChange={(event) => void useFileSyncStore.getState().setWatchMode(props.tab.id, event.target.checked)}
          />
          Watch
        </label>
        <button className={compareStyles.control} type="button" onClick={swap}>Swap</button>
        <button className={compareStyles.control} type="button" onClick={() => void useFileSyncStore.getState().compare(props.tab.id)} disabled={session.comparing}>
          Compare
        </button>
        <button className={cx(compareStyles.control, compareStyles.primary)} type="button" onClick={() => void apply()} disabled={session.applying || plannedCount === 0}>
          {session.applying ? "Applying..." : `Apply${plannedCount ? ` ${plannedCount}` : ""}`}
        </button>
      </div>
      <div className={compareStyles.summary}>
        <span>Left: {leftPane?.path ?? "--"}</span>
        <span>Right: {rightPane?.path ?? "--"}</span>
        <span>Left only: {counts.left_only}</span>
        <span>Right only: {counts.right_only}</span>
        <span>Different: {counts.different}</span>
        <span>Conflict: {counts.conflict}</span>
        {session.error || pairError ? <span className={compareStyles.error}>{session.error ?? pairError}</span> : null}
        {session.message ? <span className={compareStyles.success}>{session.message}</span> : null}
      </div>
      {session.rows.length > 0 ? (
        <details className={compareStyles.results}>
          <summary className={compareStyles.resultsSummary}>{session.rows.length} comparison results</summary>
          <div className={compareStyles.resultsScroll}>
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

const assistantPanelStyles = {
  claudeResizer:
    "col-start-2 row-start-1 cursor-col-resize border-x border-[#292929] bg-[#0f0f0f] hover:bg-[#303030] max-[980px]:hidden",
  claudePanel:
    "col-start-3 row-start-1 grid min-h-0 min-w-0 grid-rows-[42px_minmax(0,1fr)] overflow-hidden bg-[#111111] text-[#e2e2e2] max-[980px]:absolute max-[980px]:bottom-[22px] max-[980px]:right-0 max-[980px]:top-0 max-[980px]:z-20 max-[980px]:w-[min(var(--claude-panel-width,380px),100%)] max-[980px]:border-l max-[980px]:border-[#292929] max-[980px]:shadow-[-16px_0_38px_rgba(0,0,0,0.34)]",
  chatOverlay:
    "absolute bottom-[76px] right-[18px] z-[19] grid max-h-[min(620px,calc(100vh_-_120px))] w-[min(420px,calc(100vw_-_180px))] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-xl border border-[#323232] bg-[rgba(17, 17, 17, 0.96)] text-[#e2e2e2] shadow-[0_18px_42px_rgba(0,0,0,0.44)] backdrop-blur-[14px]",
  header:
    "flex h-[42px] min-w-0 items-center justify-between gap-2.5 border-b border-[#292929] py-0 pr-2.5",
  chatHeader: "pl-[13px]",
  claudeHeader: "pl-3.5",
  headerTitle:
    "inline-flex min-w-0 items-center gap-2 overflow-hidden text-ellipsis whitespace-nowrap font-semibold",
  runningBadge: "text-[11px] font-semibold text-[#c1c1c1]",
  headerButton:
    "inline-flex size-[30px] flex-none items-center justify-center gap-2 rounded-lg border-0 bg-transparent p-0 text-[#b3b3b3] hover:bg-[#252525] hover:text-[#f7f7f7]",
  chatBody:
    "grid min-h-0 grid-rows-[auto_minmax(90px,1fr)_auto] gap-2.5 overflow-hidden p-[13px]",
  claudeBody:
    "grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-3 overflow-auto p-4",
  status:
    "grid border-b border-[#292929]",
  chatStatus: "gap-2 pb-2.5",
  claudeStatus: "gap-2.5 pb-3",
  chatDetails:
    "m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5",
  claudeDetails: "m-0 grid gap-[7px]",
  detailLabel: "text-[#898989]",
  claudeDetailLabel: "text-xs uppercase",
  chatDetailValue:
    "m-0 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
  claudeDetailValue: "m-0 min-w-0 break-words",
  errorText: "m-0 text-[#b0b0b0]",
  log:
    "grid min-h-0 content-start overflow-auto pr-0.5",
  chatLog: "gap-2",
  claudeLog: "min-w-0 gap-2.5",
  emptyLog: "m-[18px] text-[var(--misty-text-muted)]",
  message:
    "grid min-w-0 rounded-lg border border-[#292929] bg-[#161616]",
  chatMessage: "gap-[5px] p-[9px]",
  claudeMessage: "gap-1.5 p-2.5",
  userMessage: "border-[#444444] bg-[#212121]",
  toolMessage: "border-[#3f3f3f] bg-[#181818]",
  errorMessage: "border-[#3f3f3f] bg-[#181818]",
  messageTitle: "text-xs text-[#f7f7f7]",
  messageText:
    "m-0 whitespace-pre-wrap break-words font-[inherit] leading-normal text-[#d4d4d4]",
  composer:
    "grid border-t border-[#292929]",
  chatComposer: "gap-[9px] pt-2.5",
  claudeComposer: "gap-2.5 pt-3",
  textarea:
    "min-w-0 resize-y rounded-lg border border-[#2f2f2f] bg-[#0b0b0b] px-2.5 py-[9px] font-[inherit] leading-snug text-[#f7f7f7] disabled:text-[#898989]",
  composerActions: "flex justify-end gap-2",
  claudeComposerActions: "gap-0",
  composerButton:
    "min-h-8 rounded-lg border border-[#3f3f3f] bg-[#252525] px-3 font-semibold text-[#f7f7f7] hover:not-disabled:bg-[#303030] disabled:opacity-55",
  claudeComposerButton: "px-3.5",
  secondaryButton: "bg-transparent text-[#b3b3b3]",
} as const;

function assistantMessageClass(role: string, density: "chat" | "claude"): string {
  return cx(
    assistantPanelStyles.message,
    density === "chat" ? assistantPanelStyles.chatMessage : assistantPanelStyles.claudeMessage,
    role === "user" && assistantPanelStyles.userMessage,
    role === "tool" && assistantPanelStyles.toolMessage,
    role === "error" && assistantPanelStyles.errorMessage,
  );
}

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
    <section className={assistantPanelStyles.chatOverlay} aria-label="Explorer chat">
      <header className={cx(assistantPanelStyles.header, assistantPanelStyles.chatHeader)}>
        <span className={assistantPanelStyles.headerTitle}>
          <MessageSquare size={16} />
          Chat
          {running ? <small className={assistantPanelStyles.runningBadge}>Running</small> : null}
        </span>
        <button className={assistantPanelStyles.headerButton} type="button" aria-label="Close chat" onClick={closeOverlay}>
          <X size={16} />
        </button>
      </header>
      <div className={assistantPanelStyles.chatBody}>
        <div className={cx(assistantPanelStyles.status, assistantPanelStyles.chatStatus)}>
          <dl className={assistantPanelStyles.chatDetails}>
            <dt className={assistantPanelStyles.detailLabel}>Status</dt>
            <dd className={assistantPanelStyles.chatDetailValue}>{status ? (installed ? "Claude CLI ready" : "Claude CLI not found") : "Checking Claude CLI..."}</dd>
            <dt className={assistantPanelStyles.detailLabel}>Folder</dt>
            <dd className={assistantPanelStyles.chatDetailValue}>{workingDirectory || "No active folder"}</dd>
            <dt className={assistantPanelStyles.detailLabel}>Selection</dt>
            <dd className={assistantPanelStyles.chatDetailValue}>{selectedEntry?.path ?? "None"}</dd>
          </dl>
          {error ? <p className={assistantPanelStyles.errorText}>{error}</p> : null}
        </div>
        <div ref={logRef} className={cx(assistantPanelStyles.log, assistantPanelStyles.chatLog)} aria-live="polite">
          {messages.length === 0 ? (
            <p className={assistantPanelStyles.emptyLog}>Ask about the active folder or selected file.</p>
          ) : messages.map((message) => (
            <article key={message.id} className={assistantMessageClass(message.role, "chat")}>
              <strong className={assistantPanelStyles.messageTitle}>{message.role === "user" ? "You" : message.role === "tool" ? "Tool" : message.role === "error" ? "Error" : "Claude"}</strong>
              <pre className={assistantPanelStyles.messageText}>{message.text || (message.role === "assistant" && running ? "Thinking..." : "")}</pre>
            </article>
          ))}
        </div>
        <form
          className={cx(assistantPanelStyles.composer, assistantPanelStyles.chatComposer)}
          onSubmit={(event) => {
            event.preventDefault();
            submitPrompt();
          }}
        >
          <textarea
            className={assistantPanelStyles.textarea}
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
          <div className={assistantPanelStyles.composerActions}>
            <button type="button" className={cx(assistantPanelStyles.composerButton, assistantPanelStyles.secondaryButton)} onClick={openPanel}>Open Panel</button>
            {running ? (
              <button className={assistantPanelStyles.composerButton} type="button" onClick={abortPrompt}>Stop</button>
            ) : (
              <button className={assistantPanelStyles.composerButton} type="submit" disabled={!installed || !prompt.trim()}>Send</button>
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
    <aside className={assistantPanelStyles.claudePanel} aria-label="Claude">
      <header className={cx(assistantPanelStyles.header, assistantPanelStyles.claudeHeader)}>
        <span className={assistantPanelStyles.headerTitle}>
          <MessageSquare size={16} />
          Claude
          {running ? <small className={assistantPanelStyles.runningBadge}>Running</small> : null}
        </span>
        <button className={assistantPanelStyles.headerButton} type="button" aria-label="Close Claude" onClick={() => useExplorerStore.getState().setClaudePanelOpen(false)}>
          <X size={16} />
        </button>
      </header>
      <div className={assistantPanelStyles.claudeBody}>
        <div className={cx(assistantPanelStyles.status, assistantPanelStyles.claudeStatus)}>
          <dl className={assistantPanelStyles.claudeDetails}>
            <dt className={cx(assistantPanelStyles.detailLabel, assistantPanelStyles.claudeDetailLabel)}>Status</dt>
            <dd className={assistantPanelStyles.claudeDetailValue}>{status ? (installed ? "Claude CLI ready" : "Claude CLI not found") : "Checking Claude CLI..."}</dd>
            <dt className={cx(assistantPanelStyles.detailLabel, assistantPanelStyles.claudeDetailLabel)}>Working directory</dt>
            <dd className={assistantPanelStyles.claudeDetailValue}>{workingDirectory || "No active folder"}</dd>
            <dt className={cx(assistantPanelStyles.detailLabel, assistantPanelStyles.claudeDetailLabel)}>Selection</dt>
            <dd className={assistantPanelStyles.claudeDetailValue}>{selectedEntry?.path ?? "None"}</dd>
          </dl>
          {error ? <p className={assistantPanelStyles.errorText}>{error}</p> : null}
        </div>
        <div ref={logRef} className={cx(assistantPanelStyles.log, assistantPanelStyles.claudeLog)} aria-live="polite">
          {messages.length === 0 ? (
            <p className={assistantPanelStyles.emptyLog}>Ask Claude about the active folder or selected file.</p>
          ) : messages.map((message) => (
            <article key={message.id} className={assistantMessageClass(message.role, "claude")}>
              <strong className={assistantPanelStyles.messageTitle}>{message.role === "user" ? "You" : message.role === "tool" ? "Tool" : message.role === "error" ? "Error" : "Claude"}</strong>
              <pre className={assistantPanelStyles.messageText}>{message.text || (message.role === "assistant" && running ? "Thinking..." : "")}</pre>
            </article>
          ))}
        </div>
        <form
          className={cx(assistantPanelStyles.composer, assistantPanelStyles.claudeComposer)}
          onSubmit={(event) => {
            event.preventDefault();
            submitPrompt();
          }}
        >
          <textarea
            className={assistantPanelStyles.textarea}
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
          <div className={cx(assistantPanelStyles.composerActions, assistantPanelStyles.claudeComposerActions)}>
            {running ? (
              <button className={cx(assistantPanelStyles.composerButton, assistantPanelStyles.claudeComposerButton)} type="button" onClick={abortPrompt}>Stop</button>
            ) : (
              <button className={cx(assistantPanelStyles.composerButton, assistantPanelStyles.claudeComposerButton)} type="submit" disabled={!installed || !prompt.trim()}>Send</button>
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
  const { menuRef, style: menuStyle } = useViewportAnchoredMenu(open, x, y);

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
      className={contextMenuStyles.menu}
      style={menuStyle}
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
      <div className={contextMenuStyles.separator} />
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
      <div className={contextMenuStyles.separator} />
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
          <div className={contextMenuStyles.separator} />
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
          <div className={contextMenuStyles.separator} />
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
          <div className={contextMenuStyles.separator} />
          <ContextMenuItem
            icon={<Eye size={17} />}
            label={showHidden ? "Hide Hidden Files" : "Show Hidden Files"}
            shortcut={shortcut(`${primaryShortcut}+Shift+.`)}
            onRun={() => run(() => void useExplorerStore.getState().toggleHidden(paneId))}
          />
        </>
      )}
      <div className={contextMenuStyles.separator} />
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
      className={contextMenuStyles.item}
      disabled={props.disabled}
      title={props.disabled ? props.disabledReason : undefined}
      onClick={props.onRun}
    >
      <span className={contextMenuStyles.icon}>{props.icon}</span>
      <span className={contextMenuStyles.label}>{props.label}</span>
      {props.shortcut ? <span className={contextMenuStyles.shortcut}>{props.shortcut}</span> : null}
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
    <footer className={explorerShellStyles.bottomBar}>
      <button
        type="button"
        className={cx(explorerShellStyles.bottomButton, props.sidebarVisible && explorerShellStyles.bottomButtonSelected)}
        title={props.sidebarVisible ? "Hide sidebar" : "Show sidebar"}
        onClick={props.onToggleSidebar}
      >
        <PanelLeft size={15} />
      </button>
      <button
        type="button"
        className={cx(explorerShellStyles.bottomButton, props.previewVisible && explorerShellStyles.bottomButtonSelected)}
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

function pluginPanelsEqual(left: PluginPanelEntry[], right: PluginPanelEntry[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((panel, index) => {
    const other = right[index];
    return panel.id === other.id
      && panel.title === other.title
      && panel.pluginId === other.pluginId
      && panel.pluginName === other.pluginName
      && panel.windowType === other.windowType
      && panel.defaultWidth === other.defaultWidth
      && panel.defaultHeight === other.defaultHeight
      && panel.pluginDir === other.pluginDir
      && panel.manifestPath === other.manifestPath
      && panel.libraryPath === other.libraryPath
      && panel.launcherViews.join("\n") === other.launcherViews.join("\n");
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
