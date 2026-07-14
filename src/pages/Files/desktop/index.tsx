import {
  Archive,
  AppWindow,
  ArrowUp,
  ArrowRightLeft,
  ChevronRight,
  Clipboard,
  Columns2,
  Copy,
  Download,
  ExternalLink,
  File,
  FileArchive,
  FilePlus,
  Eye,
  FlaskConical,
  Folder,
  FolderPlus,
  Hash,
  Info,
  Link,
  MessageSquare,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  PanelTopClose,
  Pencil,
  Pin,
  Puzzle,
  RefreshCcw,
  Rows2,
  Scissors,
  Search,
  Sparkles,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { readText, writeHtml, writeImage, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { MultiPanelWorkspace } from "../../../shared/multipanel/MultiPanelWorkspace";
import { hasTauriInternals } from "../../../shared/tauri";
import { isAndroidBuild } from "../../../platform/buildTarget";
import { explorerRootForBuild } from "../../../platform/androidStorage";
import { useAppStore } from "../../../stores/useAppStore";
import {
  clipboardApplyShared,
  clipboardPublishImageBytes,
  clipboardPublishShared,
  clipboardSetLocal,
  clipboardSharedImageBytes,
  clipboardWriteFileRefs,
  archiveCreate,
  archiveExtract,
  archiveList,
  devicesSnapshot,
  compareApplyTextMerge,
  compareFiles,
  compareFolders,
  duplicatesCancel,
  duplicatesHashRemoteCandidates,
  duplicatesScan,
  explorerListDirectory,
  explorerPreviewItem,
  explorerPrepareDragItems,
  explorerQueueDeleteItems,
  explorerQueuePasteItems,
  fileToolsChecksum,
  fileToolsCreateSymlink,
  fileToolsReadSymlink,
  openTerminalAtPath,
  operationQueueRedo,
  operationQueueUndo,
  pluginCommandRun,
  pluginCommandsSnapshot,
  pluginPanelRender,
  providersCreatePublicLink,
  providersJobStatus,
  providersVerifyResult,
  providersVerifyStart,
  shortcutsSnapshot,
  transfersSnapshot,
  androidGrantLocalFolder,
  androidAllFilesAccessStatus,
  androidOpenAllFilesAccessSettings,
} from "../../../api/misty";
import { ExplorerPane } from "../components/ExplorerPane";
import { ExplorerSidebar, type AndroidLocalGrantRequest } from "../components/ExplorerSidebar";
import { ExplorerPaneToolbarActions, ExplorerToolbar } from "../components/ExplorerToolbar";
import type { ExplorerLocationResult } from "../components/ExplorerToolbar";
import { LibraryWorkspace, libraryWorkspacePath } from "../components/LibraryWorkspace";
import { FileInspector } from "../components/FileInspector";
import {
  explorerWorkspaceNeedsSave,
  scheduleExplorerWorkspaceSave,
  selectedEntryForPane,
  selectedDeletePathsForPane,
  selectedPathsForPane,
  useExplorerStore,
  validateBatchRenameItems,
} from "../../../stores/useExplorerStore";
import type { ExplorerBatchRenameItem, ExplorerDialogState, ExplorerInlineEditState, ExplorerNotification, ExplorerSortColumn } from "../../../stores/useExplorerStore";
import { maxMultiPanelPanes, useMultiPanelStore } from "../../../shared/multipanel/useMultiPanelStore";
import { ProvidersWorkspacePanel } from "../../Providers/desktop";
import { useProvidersStore } from "../../../stores/useProvidersStore";
import type {
  AndroidAllFilesAccessStatus,
  ClipboardPayload,
  ExplorerLibrarySnapshot,
  FileEntry,
  MountedDevice,
  PluginCommandEntry,
  PluginPanelElement,
  PluginPanelEntry,
  PluginPanelRenderResult,
  ProviderRemote,
  TransferRecord,
  DuplicateGroup,
  DuplicateScanResult,
  CompareFilesResult,
  CompareFolderRow,
  CompareFoldersResult,
  PasteItem,
} from "../../../api/types";
import type { MultiPanelTab } from "../../../shared/multipanel/types";
import { useOperationQueueStore } from "../../../stores/useOperationQueueStore";
import { useTransfersStore } from "../../../stores/useTransfersStore";
import { TransfersWorkspacePanel } from "../../Transfers/desktop";
import { shortcutMapFromBindings, shortcutMatchesEvent } from "../../../shared/shortcuts";
import type { ShortcutMap } from "../../../shared/shortcuts";
import { selectAdvancedPreferences, selectAssistantPreferences, selectGeneralPreferences, selectShortcutPreferences, useSettingsStore } from "../../../stores/useSettingsStore";
import { openCloudFolderBotChatWindow, openCloudFolderBotWindow } from "../../../bots/cloudFolderBot";
import { errorText } from "../../../shared/format";
import { applyMistyThemeFromExtensionAction } from "../../../stores/useAppThemeStore";
import { ExtensionCatalogIcon } from "../../../plugins/ExtensionCatalogIcon";
import { pluginCatalogChangedEvent } from "../../../plugins/pluginEvents";
import { publishPluginNotifications } from "../../../plugins/pluginNotifications";
import { clipboardImagePng } from "../utils/clipboardImage";
import { formatBytes, formatDate } from "../utils/fileFormat";
import { revealSearchResultInPane } from "../utils/searchNavigation";
import type { ExplorerSearchNavigationTarget } from "../utils/searchNavigation";
import { cx } from "./ExplorerDesktopShared";
import { explorerShellStyles } from "./ExplorerShellStyles";
import { ConnectedExplorerToolbar, ConnectedFileInspector, ExplorerPaneHeaderActions } from "./ExplorerToolbarConnections";
import { defaultExplorerShortcutMap, executableShortcutCommands, runExplorerCommand, runPluginCommand, shortcutCommandForEvent } from "./ExplorerCommands";
import { buildExplorerLocationResults, clamp, ExplorerBottomBar, mountedDevicesEqual, multiPanelWorkspaceNeedsSave, pluginCommandsEqual, pluginPanelsEqual, resolveMountRoot, resolvePreferredWorkspaceRoot, workspaceSearchPaths } from "./ExplorerWorkspaceUtils";
import { ExplorerNotifications, ExplorerRenameStatus } from "./ExplorerDesktopStatus";
import {
  canOpenTerminalPath,
  ExplorerPluginTabContent,
  ExplorerPluginTabHeader,
  ExplorerTray,
  isChromeTabPath,
  isRemotesTabPath,
  isTransfersTabPath,
  openRemotesTab,
  openTransfersTab,
  parsePluginTabPath,
  toggleActiveTabPanelVisibility,
} from "./ExplorerDesktopPlugins";
import { ExplorerDialog } from "./ExplorerBatchRenameDialog";
import { CompareDialog } from "./ExplorerCompareDialog";
import type { CompareDialogSeed } from "./ExplorerCompareDialog";
import { DuplicateFinderDialog } from "./ExplorerDuplicateFinderDialog";
import { compareSeedForPane, ExplorerContextMenu, openCompareWith } from "./ExplorerContextMenu";

const minSidebarWidth = 212;
const maxSidebarWidth = 380;
const minPreviewWidth = 240;
const maxPreviewWidth = 420;
const transferRefreshPollMs = 12000;
const devicesChangedEvent = "misty://devices-changed";
const explorerSearchFocusEvent = "misty:explorer-search-focus";
const explorerDuplicateFinderEvent = "misty:explorer-duplicate-finder";
const explorerCompareWithEvent = "misty:explorer-compare-with";
const emptyPinnedPaths: string[] = [];
const emptyProviderRemotes: ProviderRemote[] = [];
const emptyPluginCommands: PluginCommandEntry[] = [];
const emptyPluginPanels: PluginPanelEntry[] = [];
const emptyMountedDevices: MountedDevice[] = [];

type ResizeTarget = "sidebar" | "preview" | null;

export const ExplorerWorkspace = memo(function ExplorerWorkspace() {
  const navigate = useNavigate();
  const app = useAppStore((state) => state.app);
  const {
    initialize,
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
  } = useExplorerStore(useShallow((state) => ({
    initialize: state.initialize,
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
  })));
  const { providersLoading, sidebarRemotes } = useProvidersStore(useShallow((state) => ({
    providersLoading: state.loading,
    sidebarRemotes: state.providers?.remotes ?? emptyProviderRemotes,
  })));
  const {
    activePaneId,
    activeTabPath,
    activeTabPreviewVisible,
    activeTabSidebarVisible,
    workspacePathSignature,
  } = useMultiPanelStore(useShallow((state) => {
    const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0];
    return {
      activePaneId: state.activePaneId,
      activeTabPath: activeTab?.path ?? "",
      activeTabPreviewVisible: activeTab?.previewVisible ?? true,
      activeTabSidebarVisible: activeTab?.sidebarVisible ?? true,
      workspacePathSignature: state.tabs
        .flatMap((tab) => [tab.path, ...tab.panes.map((pane) => pane.path)])
        .join("\n"),
    };
  }));
  const workspaceRef = useRef<HTMLElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const pendingResizeXRef = useRef(0);
  const resizeTargetRef = useRef<ResizeTarget>(null);
  const pendingResizeSaveRef = useRef(false);
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
  const [androidAllFilesAccess, setAndroidAllFilesAccess] = useState<AndroidAllFilesAccessStatus | null>(null);
  const [androidGrantedFolders, setAndroidGrantedFolders] = useState<FileEntry[]>([]);
  const [duplicateFinderPaneId, setDuplicateFinderPaneId] = useState<string | null>(null);
  const [compareDialog, setCompareDialog] = useState<CompareDialogSeed | null>(null);
  const { mikaEnabled, preferredWorkspaceRoot, settingsLoaded, settingsMountPath } = useSettingsStore(useShallow((state) => ({
    mikaEnabled: selectAssistantPreferences(state.settings?.document).enabled,
    preferredWorkspaceRoot: selectGeneralPreferences(state.settings?.document).preferredWorkspaceRoot,
    settingsMountPath: selectAdvancedPreferences(state.settings?.document).mountPath,
    settingsLoaded: state.loaded,
  })));
  const shortcutPreferences = useSettingsStore(useShallow((state) =>
    selectShortcutPreferences(state.settings?.document),
  ));
  const environmentHomePath = app?.environment.homeDir ?? "/";
  const storageHomePath = resolvePreferredWorkspaceRoot(preferredWorkspaceRoot, environmentHomePath);
  const homePath = explorerRootForBuild(storageHomePath);
  const mountRoot = resolveMountRoot(storageHomePath, settingsMountPath || app?.environment.mountPath || ".misty/mnt");
  const activePath = useExplorerStore((state) => state.panes[activePaneId]?.listing?.path ?? homePath);
  const extensionsEnabled = !isAndroidBuild;
  const activeSelectedPath = useExplorerStore((state) => selectedPathsForPane(state.panes[activePaneId])[0] ?? activePath);

  useEffect(() => {
    if (!extensionsEnabled) return;
    const multi = useMultiPanelStore.getState();
    const legacyTabs = multi.tabs
      .map((tab) => ({ tab, plugin: parsePluginTabPath(tab.path) }))
      .filter((entry): entry is { tab: MultiPanelTab; plugin: NonNullable<ReturnType<typeof parsePluginTabPath>> } => Boolean(entry.plugin));
    if (legacyTabs.length === 0) return;
    const activeLegacy = legacyTabs.find(({ tab }) => tab.id === multi.activeTabId) ?? legacyTabs[0];
    for (const { tab } of legacyTabs) {
      multi.updateActiveTabPath(tab.activePaneId, homePath, "Files");
      multi.setTabPanelVisibility(tab.id, { sidebarVisible: true, previewVisible: true });
    }
    const params = new URLSearchParams({ extension: activeLegacy.plugin.pluginId });
    if (activeLegacy.plugin.selectedPath) params.set("selected", activeLegacy.plugin.selectedPath);
    navigate(`/files?${params.toString()}`, { replace: true });
  }, [extensionsEnabled, homePath, navigate, workspacePathSignature]);
  const activePaneIdRef = useRef(activePaneId);
  const activePathRef = useRef(activePath);
  const shortcutMapRef = useRef<ShortcutMap>(defaultExplorerShortcutMap(shortcutPreferences.keymapIndex));
  const executableCommandIdsRef = useRef<readonly string[]>(executableShortcutCommands);
  const workspacePaths = useMemo(
    () => workspacePathSignature.split("\n").filter(Boolean),
    [workspacePathSignature],
  );
  const locationResults = useMemo(
    () => buildExplorerLocationResults(homePath, mountRoot, pinnedPaths, sidebarRemotes, library, workspacePaths, isAndroidBuild),
    [homePath, library, mountRoot, pinnedPaths, sidebarRemotes, workspacePaths],
  );
  const workspaceStyle = useMemo(() => ({
    "--explorer-sidebar-width": `${sidebarWidth}px`,
    "--preview-width": `${previewWidth}px`,
  } as CSSProperties), [previewWidth, sidebarWidth]);
  const activeTabSupportsSidePanels = !isChromeTabPath(activeTabPath);
  const sidebarVisible = activeTabSupportsSidePanels && activeTabSidebarVisible;
  const previewVisible = activeTabSupportsSidePanels && activeTabPreviewVisible;

  useEffect(() => {
    activePaneIdRef.current = activePaneId;
    activePathRef.current = activePath;
  }, [activePaneId, activePath]);

  useEffect(() => {
    const openDuplicateFinder = (event: Event) => {
      const detail = (event as CustomEvent<{ paneId?: string }>).detail;
      setDuplicateFinderPaneId(detail?.paneId || activePaneIdRef.current);
    };
    window.addEventListener(explorerDuplicateFinderEvent, openDuplicateFinder);
    return () => window.removeEventListener(explorerDuplicateFinderEvent, openDuplicateFinder);
  }, []);

  useEffect(() => {
    const openCompareWith = (event: Event) => {
      const detail = (event as CustomEvent<CompareDialogSeed>).detail;
      setCompareDialog(detail ?? compareSeedForPane(activePaneIdRef.current));
    };
    window.addEventListener(explorerCompareWithEvent, openCompareWith);
    return () => window.removeEventListener(explorerCompareWithEvent, openCompareWith);
  }, []);

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
    if (!extensionsEnabled) {
      shortcutMapRef.current = defaultExplorerShortcutMap(shortcutPreferences.keymapIndex);
      executableCommandIdsRef.current = executableShortcutCommands;
      pluginCommandsRef.current = emptyPluginCommands;
      setPluginCommands(emptyPluginCommands);
      setPluginPanels(emptyPluginPanels);
      return;
    }
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
  }, [extensionsEnabled, shortcutPreferences.customShortcutsEnabled, shortcutPreferences.keymapIndex]);

  const refreshDevices = useCallback(async (options?: { showLoading?: boolean }) => {
    if (deviceRefreshInFlightRef.current) return;
    const showLoading = options?.showLoading ?? true;
    deviceRefreshInFlightRef.current = true;
    if (showLoading && deviceRefreshMountedRef.current) setDevicesLoading(true);
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
      if (showLoading && deviceRefreshMountedRef.current) setDevicesLoading(false);
    }
  }, []);

  const refreshAndroidGrantedFolders = useCallback(async (): Promise<FileEntry[]> => {
    if (!isAndroidBuild) return [];
    try {
      const listing = await explorerListDirectory({ path: homePath, showHidden: false });
      const folders = listing.entries.filter((entry) => entry.kind === "folder");
      setAndroidGrantedFolders(folders);
      return folders;
    } catch {
      setAndroidGrantedFolders([]);
      return [];
    }
  }, [homePath]);

  const refreshAndroidAllFilesAccess = useCallback(async (): Promise<AndroidAllFilesAccessStatus | null> => {
    if (!isAndroidBuild) return null;
    try {
      const status = await androidAllFilesAccessStatus();
      setAndroidAllFilesAccess(status);
      return status;
    } catch {
      setAndroidAllFilesAccess(null);
      return null;
    }
  }, []);

  useEffect(() => {
    if (!isAndroidBuild) return;
    void refreshAndroidAllFilesAccess();
    void refreshAndroidGrantedFolders();
    const refreshOnFocus = () => {
      void refreshAndroidAllFilesAccess();
      void refreshAndroidGrantedFolders();
    };
    const refreshOnVisibility = () => {
      if (document.visibilityState === "visible") refreshOnFocus();
    };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnVisibility);
    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnVisibility);
    };
  }, [refreshAndroidAllFilesAccess, refreshAndroidGrantedFolders]);

  useEffect(() => {
    deviceRefreshMountedRef.current = true;
    void refreshDevices();
    const refreshOnFocus = () => void refreshDevices();
    window.addEventListener("focus", refreshOnFocus);
    let active = true;
    let unlisten: UnlistenFn | null = null;
    const eventRefreshTimers = new Set<number>();
    const refreshFromDeviceEvent = () => {
      void refreshDevices({ showLoading: false });
      const timer = window.setTimeout(() => {
        eventRefreshTimers.delete(timer);
        void refreshDevices({ showLoading: false });
      }, 1200);
      eventRefreshTimers.add(timer);
    };
    void (async () => {
      try {
        if (!hasTauriInternals()) return;
        const stopListening = await listen(devicesChangedEvent, refreshFromDeviceEvent);
        if (active) {
          unlisten = stopListening;
        } else {
          void stopListening();
        }
      } catch {}
    })();
    return () => {
      active = false;
      deviceRefreshMountedRef.current = false;
      window.removeEventListener("focus", refreshOnFocus);
      eventRefreshTimers.forEach((timer) => window.clearTimeout(timer));
      if (unlisten) void unlisten();
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
  }, [homePath, navigate]);

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

  const startSidebarResize = useCallback((event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setResizeTarget("sidebar");
  }, []);

  const startPreviewResize = useCallback((event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setResizeTarget("preview");
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
      if (isChromeTabPath(path) || path === libraryWorkspacePath) return null;
      const pluginTab = extensionsEnabled ? parsePluginTabPath(path) : null;
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
    [extensionsEnabled, locationResults, navigate, pluginCommands, pluginPanels],
  );
  const renderPane = useCallback(
    (paneId: string, path: string) => {
      const paneActions = activePaneId === paneId ? <ExplorerPaneHeaderActions paneId={paneId} /> : undefined;
      if (isTransfersTabPath(path)) {
        return <TransfersWorkspacePanel workspaceId={paneId} />;
      }
      if (isRemotesTabPath(path)) {
        return <ProvidersWorkspacePanel workspaceId={paneId} />;
      }
      if (path === libraryWorkspacePath) {
        return <LibraryWorkspace paneId={paneId} workingDirectory={homePath} />;
      }
      const pluginTab = extensionsEnabled ? parsePluginTabPath(path) : null;
      if (pluginTab) {
        return (
          <ExplorerPluginTabContent
            tab={pluginTab}
            commands={pluginCommands}
            panels={pluginPanels}
          />
        );
      }
      return <ExplorerPane paneId={paneId} path={path} isActive={activePaneId === paneId} paneActions={paneActions} />;
    },
    [activePaneId, extensionsEnabled, homePath, pluginCommands, pluginPanels],
  );
  const inspector = useMemo(
    () => previewVisible ? <ConnectedFileInspector /> : undefined,
    [previewVisible],
  );
  const openSidebarPathInNewTab = useCallback((path: string, title?: string) => {
    useMultiPanelStore.getState().addTab(path, title);
  }, []);
  const handleManageRemotes = useCallback(() => {
    openRemotesTab();
  }, []);
  const handleAddRemote = useCallback(() => {
    openRemotesTab();
    void useProvidersStore.getState().openAddRemote();
  }, []);
  const handleGrantLocalFolder = useCallback((request?: AndroidLocalGrantRequest) => {
    void (async () => {
      const currentStatus = await refreshAndroidAllFilesAccess();
      if (!currentStatus?.granted) {
        try {
          await androidOpenAllFilesAccessSettings();
          useExplorerStore.getState().pushNotification("Enable All files access for Misty, then return to continue browsing local files.", "info");
        } catch (error) {
          useExplorerStore.getState().pushNotification(`Could not open Android storage settings: ${errorText(error)}`, "error");
        }
        return;
      }
      const storageRoot = currentStatus.storageRoot?.replace(/\/+$/, "");
      if (storageRoot) {
        const paneId = useMultiPanelStore.getState().activePaneId;
        const targetPath = request?.initialDirectory
          ? `${storageRoot}/${request.initialDirectory.replace(/^\/+|\/+$/g, "")}`
          : storageRoot;
        if (paneId) await useExplorerStore.getState().navigatePane(paneId, targetPath);
        return;
      }
      if (request?.grantedPath) {
        const paneId = useMultiPanelStore.getState().activePaneId;
        if (paneId) await useExplorerStore.getState().navigatePane(paneId, request.grantedPath);
        return;
      }
      try {
        const folder = await androidGrantLocalFolder({
          initialDirectory: request?.initialDirectory,
        });
        await refreshAndroidGrantedFolders();
        const paneId = useMultiPanelStore.getState().activePaneId;
        if (paneId) await useExplorerStore.getState().navigatePane(paneId, folder.path || homePath);
        useExplorerStore.getState().pushNotification(`Added local folder ${folder.name}`, "success");
      } catch (error) {
        const message = errorText(error);
        if (!/cancel/i.test(message)) {
          useExplorerStore.getState().pushNotification(`Could not add local folder: ${message}`, "error");
        }
      }
    })();
  }, [homePath, refreshAndroidAllFilesAccess, refreshAndroidGrantedFolders]);
  const explorerSidebar = useMemo(() => (sidebarVisible ? (
    <ExplorerSidebar
      homePath={homePath}
      activePath={activePath}
      mountRoot={mountRoot}
      remotes={sidebarRemotes}
      remoteLoading={providersLoading}
      library={library}
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
      onOpenInNewTab={openSidebarPathInNewTab}
      onManageRemotes={handleManageRemotes}
      onAddRemote={handleAddRemote}
      androidLocal={isAndroidBuild}
      androidAllFilesAccess={androidAllFilesAccess}
      androidGrantedFolders={androidGrantedFolders}
      onGrantLocalFolder={handleGrantLocalFolder}
      onUnpinPinnedPath={useExplorerStore.getState().togglePinnedPath}
    />
  ) : undefined), [
    activePath,
    activeWorkspaceId,
    activeWorkspaceTitle,
    androidAllFilesAccess,
    androidGrantedFolders,
    devicesLoading,
    handleCreateWorkspace,
    handleDeleteWorkspace,
    handleRenameWorkspace,
    handleSelectWorkspace,
    handleAddRemote,
    handleGrantLocalFolder,
    handleManageRemotes,
    homePath,
    library,
    mountRoot,
    mountedDevices,
    navigateSidebar,
    openSidebarPathInNewTab,
    pinnedPaths,
    providersLoading,
    refreshDevices,
    sidebarRemotes,
    sidebarVisible,
    workspaceEntries,
  ]);
  const renderTabActions = useCallback(
    () => (
      <ExplorerTray
        commands={pluginCommands}
        extensionsEnabled={extensionsEnabled}
        panels={pluginPanels}
        selectedPath={activeSelectedPath}
        mikaEnabled={mikaEnabled}
        onOpenMika={() => {
          if (!mikaEnabled) return;
          void openCloudFolderBotWindow(app?.environment.assetsDir).then(() => openCloudFolderBotChatWindow());
        }}
        terminalEnabled={activeTabSupportsSidePanels && canOpenTerminalPath(activeTabPath) && canOpenTerminalPath(activePath)}
        terminalPath={activePath}
        onOpenTransfers={openTransfersTab}
      />
    ),
    [
      activePath,
      activeSelectedPath,
      activeTabPath,
      activeTabSupportsSidePanels,
      extensionsEnabled,
      mikaEnabled,
      app?.environment.assetsDir,
      pluginCommands,
      pluginPanels,
    ],
  );
  const renderBottomBar = useCallback(
    (tab: MultiPanelTab) => {
      if (isChromeTabPath(tab.path)) return null;
      return (
        <ExplorerBottomBar
          sidebarVisible={tab.sidebarVisible ?? true}
          previewVisible={tab.previewVisible ?? true}
          onToggleSidebar={() => useMultiPanelStore.getState().setTabPanelVisibility(tab.id, { sidebarVisible: !(tab.sidebarVisible ?? true) })}
          onTogglePreview={() => useMultiPanelStore.getState().setTabPanelVisibility(tab.id, { previewVisible: !(tab.previewVisible ?? true) })}
        />
      );
    },
    [],
  );

  return (
    <section
      ref={workspaceRef}
      className={cx(
        explorerShellStyles.workspaceBase,
        !sidebarVisible && explorerShellStyles.workspaceCollapsed,
      )}
      style={workspaceStyle}
    >
      <main ref={mainRef} className={explorerShellStyles.main}>
        <MultiPanelWorkspace
          className="explorer-multipanel"
          renderBottomBar={renderBottomBar}
          renderTabActions={renderTabActions}
          renderToolbar={renderToolbar}
          showDefaultPaneControls={false}
          renderNavigationAside={explorerSidebar}
          onNavigationAsideResizeStart={startSidebarResize}
          navigationAsideResizing={resizeTarget === "sidebar"}
          renderAside={inspector}
          onAsideResizeStart={startPreviewResize}
          asideResizing={resizeTarget === "preview"}
          renderPane={renderPane}
        />
      </main>
      <ExplorerRenameStatus edit={inlineEdit} />
      <ExplorerNotifications notifications={notifications} onDismiss={dismissNotification} />
      {duplicateFinderPaneId ? (
        <DuplicateFinderDialog
          paneId={duplicateFinderPaneId}
          defaultRoot={useExplorerStore.getState().panes[duplicateFinderPaneId]?.listing?.path ?? activePath}
          onClose={() => setDuplicateFinderPaneId(null)}
        />
      ) : null}
      {compareDialog ? <CompareDialog seed={compareDialog} onClose={() => setCompareDialog(null)} /> : null}
      <ExplorerContextMenu />
      <ExplorerDialog />
    </section>
  );
});

export default ExplorerWorkspace;
