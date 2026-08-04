import type { ResizeTarget } from "@/models/types/features/explorer/desktop/index";
export type { ResizeTarget } from "@/models/types/features/explorer/desktop/index";
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
import { readText, writeHtml, writeImage, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useNavigate } from "react-router-dom";
import { routes } from "@/routing/paths";
import { useShallow } from "zustand/react/shallow";
import { MultiPanelWorkspace } from "@/features/workspace";
import { useTransientScrollbars } from "@/hooks/useTransientScrollbars";
import { isAndroidBuild } from "@/platform/buildTarget";
import { useAppRouteMemoryStore, useAppStore } from "@/stores/app";
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
  compareApplyTextMerge,
  compareFiles,
  compareFolders,
  duplicatesCancel,
  duplicatesHashRemoteCandidates,
  duplicatesScan,
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
  providersJobStatus,
  providersVerifyResult,
  providersVerifyStart,
  shortcutsSnapshot,
  transfersSnapshot,
  androidGrantLocalFolder,
  androidOpenAllFilesAccessSettings,
} from "@/stores/backend";
import { ExplorerPane } from "../components/ExplorerPane";
import { ExplorerSidebar } from "../components/ExplorerSidebar";
import type { AndroidLocalGrantRequest } from "@/models/interfaces/features/explorer/components/ExplorerSidebar";
import { ExplorerPaneToolbarActions, ExplorerToolbar } from "../components/ExplorerToolbar";
import type { ExplorerLocationResult } from "../components/ExplorerToolbar";
import { LibraryWorkspace, libraryWorkspacePath } from "../components/LibraryWorkspace";
import { FileInspector } from "../components/FileInspector";
import { ExplorerLoadingShell } from "../components/ExplorerLoadingShell";
import {
  explorerWorkspaceNeedsSave,
  scheduleExplorerWorkspaceSave,
  selectedEntryForPane,
  selectedDeletePathsForPane,
  useExplorerStore,
  validateBatchRenameItems,
} from "@/stores/explorer";
import type {
  ExplorerBatchRenameItem,
  ExplorerDialogState,
  ExplorerInlineEditState,
  ExplorerNotification,
  ExplorerSortColumn,
} from "@/stores/explorer";
import { maxMultiPanelPanes, useMultiPanelStore } from "@/features/workspace";
import { ProvidersWorkspacePanel } from "@/pages/Providers/desktop";
import { useProvidersStore } from "@/stores/providers";
import type {
  ClipboardPayload,
  ExplorerLibrarySnapshot,
  PluginCommandEntry,
  PluginPanelElement,
  PluginPanelEntry,
  PluginPanelRenderResult,
  TransferRecord,
  DuplicateGroup,
  DuplicateScanResult,
  CompareFilesResult,
  CompareFolderRow,
  CompareFoldersResult,
  PasteItem,
} from "@/models/interfaces/services/misty-api";
import type { MultiPanelTab } from "@/models/interfaces/workspace";
import { useOperationQueueStore } from "@/stores/explorer";
import { useTransfersStore } from "@/stores/transfers";
import { TransfersWorkspacePanel } from "@/pages/Transfers/desktop";
import { shortcutMapFromBindings, shortcutMatchesEvent } from "@/lib/shortcuts";
import type { ShortcutMap } from "@/models/types/lib/shortcuts";
import {
  selectAdvancedPreferences,
  selectGeneralPreferences,
  selectShortcutPreferences,
  useSettingsStore,
} from "@/stores/app";
import { errorText } from "@/lib/format";
import { clipboardImagePng } from "../utils/clipboardImage";
import { formatBytes, formatDate } from "../utils/fileFormat";
import { revealSearchResultInPane } from "../utils/searchNavigation";
import type { ExplorerSearchNavigationTarget } from "@/models/interfaces/features/explorer/utils/searchNavigation";
import { cx } from "./ExplorerDesktopShared";
import { explorerShellStyles } from "./ExplorerShellStyles";
import {
  ConnectedExplorerToolbar,
  ConnectedFileInspector,
  ExplorerPaneHeaderActions,
} from "./ExplorerToolbarConnections";
import {
  defaultExplorerShortcutMap,
  executableShortcutCommands,
  runExplorerCommand,
  runPluginCommand,
  shortcutCommandForEvent,
} from "./ExplorerCommands";
import {
  buildExplorerLocationResults,
  clamp,
  multiPanelWorkspaceNeedsSave,
  pluginCommandsEqual,
  pluginPanelsEqual,
  resolveMountRoot,
  resolvePreferredWorkspaceRoot,
  workspaceSearchPaths,
} from "./ExplorerWorkspaceUtils";
import { ExplorerNotifications, ExplorerRenameStatus } from "./ExplorerDesktopStatus";
import {
  canCloseExplorerTab,
  canOpenTerminalPath,
  ensureFilesBrowseTab,
  ExplorerPluginTabContent,
  ExplorerPluginTabHeader,
  ExplorerTray,
  isChromeTabPath,
  isRemotesTabPath,
  isTransfersTabPath,
  openTransfersTab,
  parsePluginTabPath,
  toggleActiveTabPanelVisibility,
} from "./ExplorerDesktopPlugins";
import { ExplorerDialog } from "./ExplorerBatchRenameDialog";
import { CompareDialog } from "./ExplorerCompareDialog";
import type { CompareDialogSeed } from "@/models/interfaces/features/explorer/desktop/ExplorerCompareDialog";
import { DuplicateFinderDialog } from "./ExplorerDuplicateFinderDialog";
import { compareSeedForPane, ExplorerContextMenu, openCompareWith } from "./ExplorerContextMenu";
import { ExplorerDragProvider } from "../drag/ExplorerDragContext";
import {
  emptyPluginCommands,
  emptyPluginPanels,
  emptyProviderRemotes,
  explorerCompareWithEvent,
  explorerDuplicateFinderEvent,
  maxPreviewWidth,
  maxSidebarWidth,
  minPreviewWidth,
  minSidebarWidth,
  transferRefreshPollMs,
} from "./ExplorerWorkspaceConstants";
import { useExplorerDevices } from "./useExplorerDevices";
import { useExplorerDialogEvents } from "./explorerWorkspace/useExplorerDialogEvents";
import { usePanelResize } from "./explorerWorkspace/usePanelResize";
import { usePluginRegistry } from "./explorerWorkspace/usePluginRegistry";
import { useTransferRefreshPolling } from "./explorerWorkspace/useTransferRefreshPolling";
import { useExplorerAgentDock } from "./ExplorerAgentDockIntegration";
import { resolveExplorerBottomBarRenderer } from "./ExplorerWorkspaceChrome";
import {
  scopedWorkspaceEntries,
  useScopedExplorerWorkspace,
  type ExplorerWorkspaceProps,
} from "./explorerWorkspace/useScopedExplorerWorkspace";

export const ExplorerWorkspace = memo(function ExplorerWorkspace(props: ExplorerWorkspaceProps) {
  const navigate = useNavigate();
  const app = useAppStore((state) => state.app);
  const {
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
  } = useExplorerStore(
    useShallow((state) => ({
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
    })),
  );
  const { providersLoading, sidebarRemotes } = useProvidersStore(
    useShallow((state) => ({
      providersLoading: state.loading,
      sidebarRemotes: state.providers?.remotes ?? emptyProviderRemotes,
    })),
  );
  const {
    activePaneId,
    activeTabPath,
    activeTabPreviewVisible,
    activeTabSidebarVisible,
    hasExplorerTabs,
    workspacePathSignature,
  } = useMultiPanelStore(
    useShallow((state) => {
      const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0];
      return {
        activePaneId: state.activePaneId,
        activeTabPath: activeTab?.path ?? "",
        activeTabPreviewVisible: activeTab?.previewVisible ?? true,
        activeTabSidebarVisible: activeTab?.sidebarVisible ?? true,
        hasExplorerTabs: state.tabs.length > 0,
        workspacePathSignature: state.tabs
          .flatMap((tab) => [tab.path, ...tab.panes.map((pane) => pane.path)])
          .join("\n"),
      };
    }),
  );
  const workspaceRef = useRef<HTMLElement | null>(null);
  useTransientScrollbars(workspaceRef);
  const mainRef = useRef<HTMLElement | null>(null);
  const { preferredWorkspaceRoot, settingsLoaded, settingsMountPath } = useSettingsStore(
    useShallow((state) => ({
      preferredWorkspaceRoot: selectGeneralPreferences(state.settings?.document)
        .preferredWorkspaceRoot,
      settingsMountPath: selectAdvancedPreferences(state.settings?.document).mountPath,
      settingsLoaded: state.loaded,
    })),
  );
  const shortcutPreferences = useSettingsStore(
    useShallow((state) => selectShortcutPreferences(state.settings?.document)),
  );
  const environmentHomePath = app?.environment.homeDir ?? "/";
  const storageHomePath = resolvePreferredWorkspaceRoot(
    preferredWorkspaceRoot,
    environmentHomePath,
  );
  const homePath = isAndroidBuild ? "misty://local" : storageHomePath;
  const {
    androidAllFilesAccess,
    androidGrantedFolders,
    devicesLoading,
    mountedDevices,
    refreshAndroidAllFilesAccess,
    refreshAndroidGrantedFolders,
    refreshDevices,
  } = useExplorerDevices(homePath);
  const mountRoot = resolveMountRoot(
    storageHomePath,
    settingsMountPath || app?.environment.mountPath || ".misty/mnt",
  );
  const activePath = useExplorerStore(
    (state) => state.panes[activePaneId]?.listing?.path ?? homePath,
  );
  const explorerInitialized = useExplorerStore((state) => state.initialized);
  const extensionsEnabled = !isAndroidBuild;
  useEffect(() => {
    if (!extensionsEnabled) return;
    const multi = useMultiPanelStore.getState();
    const legacyTabs = multi.tabs
      .map((tab) => ({ tab, plugin: parsePluginTabPath(tab.path) }))
      .filter(
        (
          entry,
        ): entry is {
          tab: MultiPanelTab;
          plugin: NonNullable<ReturnType<typeof parsePluginTabPath>>;
        } => Boolean(entry.plugin),
      );
    if (legacyTabs.length === 0) return;
    const activeLegacy =
      legacyTabs.find(({ tab }) => tab.id === multi.activeTabId) ?? legacyTabs[0];
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
  const {
    pluginCommands,
    pluginPanels,
    shortcutMapRef,
    executableCommandIdsRef,
    pluginCommandsRef,
  } = usePluginRegistry({ extensionsEnabled, shortcutPreferences });
  const { duplicateFinderPaneId, setDuplicateFinderPaneId, compareDialog, setCompareDialog } =
    useExplorerDialogEvents(activePaneIdRef);
  useTransferRefreshPolling(mountRoot);
  const { resizeTarget, startSidebarResize, startPreviewResize } = usePanelResize({
    workspaceRef,
    mainRef,
  });
  const workspacePaths = useMemo(
    () => workspacePathSignature.split("\n").filter(Boolean),
    [workspacePathSignature],
  );
  const locationResults = useMemo(
    () =>
      buildExplorerLocationResults(
        homePath,
        mountRoot,
        pinnedPaths,
        sidebarRemotes,
        library,
        workspacePaths,
        isAndroidBuild,
      ),
    [homePath, library, mountRoot, pinnedPaths, sidebarRemotes, workspacePaths],
  );
  const workspaceStyle = useMemo(
    () =>
      ({
        "--explorer-sidebar-width": `${sidebarWidth}px`,
        "--preview-width": `${previewWidth}px`,
      }) as CSSProperties,
    [previewWidth, sidebarWidth],
  );
  const activeTabSupportsSidePanels = !isChromeTabPath(activeTabPath);
  const sidebarVisible = activeTabSupportsSidePanels && activeTabSidebarVisible;
  const previewVisible = activeTabSupportsSidePanels && activeTabPreviewVisible;

  useEffect(() => {
    ensureFilesBrowseTab(homePath);
  }, [homePath, workspacePathSignature]);

  useEffect(() => {
    activePaneIdRef.current = activePaneId;
    activePathRef.current = activePath;
  }, [activePaneId, activePath]);

  useScopedExplorerWorkspace(props, homePath, settingsLoaded);

  useEffect(() => {
    if (!operationError) return;
    const message = useExplorerStore.getState().consumeOperationError();
    if (!message) return;
    const recoveredWorkspace =
      message.startsWith("Misty reset a damaged Explorer layout") ||
      message.startsWith("Workspace layout could not be restored");
    pushNotification(message, recoveredWorkspace ? "info" : "error", 4500);
  }, [operationError, pushNotification]);

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

      const commandId = shortcutCommandForEvent(
        event,
        shortcutMapRef.current,
        executableCommandIdsRef.current,
      );
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

  const navigateSidebar = useCallback((path: string) => {
    const paneId = useMultiPanelStore.getState().activePaneId;
    if (paneId) void useExplorerStore.getState().navigatePane(paneId, path);
  }, []);
  const handleSelectWorkspace = useCallback(
    (workspaceId: string) => {
      void selectWorkspace(workspaceId, homePath);
    },
    [homePath, selectWorkspace],
  );
  const handleCreateWorkspace = useCallback(
    (title: string) => {
      void createWorkspace(title, homePath);
    },
    [createWorkspace, homePath],
  );
  const handleRenameWorkspace = useCallback(
    (workspaceId: string, title: string) => {
      void renameWorkspace(workspaceId, title);
    },
    [renameWorkspace],
  );
  const handleDeleteWorkspace = useCallback(
    (workspaceId: string) => {
      void deleteWorkspace(workspaceId, homePath);
    },
    [deleteWorkspace, homePath],
  );

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
      const paneActions =
        activePaneId === paneId ? <ExplorerPaneHeaderActions paneId={paneId} /> : undefined;
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
      return (
        <ExplorerPane
          paneId={paneId}
          path={path}
          isActive={activePaneId === paneId}
          paneActions={paneActions}
        />
      );
    },
    [activePaneId, extensionsEnabled, homePath, pluginCommands, pluginPanels],
  );
  const { inspector } = useExplorerAgentDock({
    activePaneId,
    activePath,
    fallbackInspector: previewVisible ? <ConnectedFileInspector /> : undefined,
  });
  const openSidebarPathInNewTab = useCallback((path: string, title?: string) => {
    useMultiPanelStore.getState().addTab(path, title);
  }, []);
  // Remotes is presented as an overlay. Navigating to /providers is the shared
  // entry point: DesktopLayout turns it into "open the overlay and restore the
  // previous route", the same way /settings and /account behave.
  const handleManageRemotes = useCallback(() => {
    navigate(routes.providers);
  }, [navigate]);
  const handleAddRemote = useCallback(() => {
    navigate(routes.providers);
    void useProvidersStore.getState().openAddRemote();
  }, [navigate]);
  const handleGrantLocalFolder = useCallback(
    (request?: AndroidLocalGrantRequest) => {
      void (async () => {
        const currentStatus = await refreshAndroidAllFilesAccess();
        if (!currentStatus?.granted) {
          try {
            await androidOpenAllFilesAccessSettings();
            useExplorerStore
              .getState()
              .pushNotification(
                "Enable All files access for Misty, then return to continue browsing local files.",
                "info",
              );
          } catch (error) {
            useExplorerStore
              .getState()
              .pushNotification(
                `Could not open Android storage settings: ${errorText(error)}`,
                "error",
              );
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
          if (paneId)
            await useExplorerStore.getState().navigatePane(paneId, folder.path || homePath);
          useExplorerStore
            .getState()
            .pushNotification(`Added local folder ${folder.name}`, "success");
        } catch (error) {
          const message = errorText(error);
          if (!/cancel/i.test(message)) {
            useExplorerStore
              .getState()
              .pushNotification(`Could not add local folder: ${message}`, "error");
          }
        }
      })();
    },
    [homePath, refreshAndroidAllFilesAccess, refreshAndroidGrantedFolders],
  );
  const explorerSidebar = useMemo(
    () =>
      sidebarVisible ? (
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
          workspaceEntries={scopedWorkspaceEntries(workspaceEntries, props.workspaceId)}
          activeWorkspaceId={activeWorkspaceId}
          activeWorkspaceTitle={activeWorkspaceTitle}
          workspaceLocked={Boolean(props.workspaceId)}
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
      ) : undefined,
    [
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
    ],
  );
  const renderTabActions = useCallback(
    () =>
      props.workspaceId ? null : (
        <ExplorerTray
          commands={pluginCommands}
          panels={pluginPanels}
          selectedPath={activePath}
          onToggleFileManagerMode={() =>
            navigate(useAppRouteMemoryStore.getState().lastSpacesRoute)
          }
          terminalEnabled={
            activeTabSupportsSidePanels &&
            canOpenTerminalPath(activeTabPath) &&
            canOpenTerminalPath(activePath)
          }
          terminalPath={activePath}
          onOpenTransfers={openTransfersTab}
        />
      ),
    [
      activePath,
      activeTabPath,
      activeTabSupportsSidePanels,
      navigate,
      pluginCommands,
      pluginPanels,
      props.workspaceId,
    ],
  );
  if (!explorerInitialized || !hasExplorerTabs) return <ExplorerLoadingShell />;

  return (
    <ExplorerDragProvider>
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
            canCloseTab={(tab) => canCloseExplorerTab(tab, useMultiPanelStore.getState().tabs)}
            renderBottomBar={resolveExplorerBottomBarRenderer(props.embedded)}
            renderTabActions={renderTabActions}
            renderToolbar={renderToolbar}
            showTabStrip={!props.embedded}
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
            defaultRoot={
              useExplorerStore.getState().panes[duplicateFinderPaneId]?.listing?.path ?? activePath
            }
            onClose={() => setDuplicateFinderPaneId(null)}
          />
        ) : null}
        {compareDialog ? (
          <CompareDialog seed={compareDialog} onClose={() => setCompareDialog(null)} />
        ) : null}
        <ExplorerContextMenu />
        <ExplorerDialog />
      </section>
    </ExplorerDragProvider>
  );
});
export default ExplorerWorkspace;
