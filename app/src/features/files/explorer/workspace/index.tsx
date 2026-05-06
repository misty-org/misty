import { routes, useAppRouteMemoryStore, useAppStore } from "@/features/app-shell";
import { ProvidersWorkspacePanel, useProvidersStore } from "@/features/providers";
import {
  selectAdvancedPreferences,
  selectGeneralPreferences,
  selectShortcutPreferences,
  useSettingsStore,
} from "@/features/settings";
import { TransfersWorkspacePanel } from "@/features/transfers";
import { useMultiPanelStore } from "@/features/workspace";
import { useTransientScrollbars } from "@/shared/hooks/useTransientScrollbars";
import { isAndroidBuild } from "@/shared/platform/buildTarget";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { ExplorerLoadingShell } from "../components/ExplorerLoadingShell";
import { ExplorerPane } from "../components/ExplorerPane";
import { ExplorerSidebar } from "../components/ExplorerSidebar";
import { LibraryWorkspace, libraryWorkspacePath } from "../components/LibraryWorkspace";
import { ExplorerDragProvider } from "../drag/ExplorerDragContext";
import { useExplorerStore } from "../store";
import { useExplorerAgentDock } from "./ExplorerAgentDockIntegration";
import { ExplorerDialog } from "./ExplorerBatchRenameDialog";
import { CompareDialog } from "./ExplorerCompareDialog";
import { ExplorerContextMenu } from "./ExplorerContextMenu";
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
} from "./ExplorerDesktopPlugins";
import { cx } from "./ExplorerDesktopShared";
import { ExplorerNotifications, ExplorerRenameStatus } from "./ExplorerDesktopStatus";
import { DuplicateFinderDialog } from "./ExplorerDuplicateFinderDialog";
import { createExplorerAddTabControl } from "./ExplorerNewTabControl";
import { ExplorerMultiPanelWorkspace } from "./ExplorerMultiPanelWorkspace";
import { explorerShellStyles } from "./ExplorerShellStyles";
import {
  ConnectedExplorerToolbar,
  ConnectedFileInspector,
  ExplorerPaneHeaderActions,
} from "./ExplorerToolbarConnections";
import { useExplorerDialogEvents } from "./explorerWorkspace/useExplorerDialogEvents";
import { useConnectedDeviceDirectoryInvalidation } from "./explorerWorkspace/useConnectedDeviceDirectoryInvalidation";
import {
  useAndroidLocalFolderGrant,
  useExplorerKeyboardShortcuts,
  useLegacyPluginTabMigration,
  useOperationErrorNotification,
} from "./explorerWorkspace/useExplorerWorkspaceEvents";
import { usePanelResize } from "./explorerWorkspace/usePanelResize";
import { usePluginRegistry } from "./explorerWorkspace/usePluginRegistry";
import {
  scopedWorkspaceEntries,
  useScopedExplorerWorkspace,
  type ExplorerWorkspaceProps,
} from "./explorerWorkspace/useScopedExplorerWorkspace";
import { useTransferRefreshPolling } from "./explorerWorkspace/useTransferRefreshPolling";
import { resolveExplorerBottomBarRenderer } from "./ExplorerWorkspaceChrome";
import { emptyProviderRemotes } from "./ExplorerWorkspaceConstants";
import {
  buildExplorerLocationResults,
  resolveMountRoot,
  resolvePreferredWorkspaceRoot,
} from "./ExplorerWorkspaceUtils";
import { useExplorerDevices } from "./useExplorerDevices";
export type { ResizeTarget } from "../model/types/workspace/index";

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
  useLegacyPluginTabMigration({ extensionsEnabled, homePath, navigate, workspacePathSignature });
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
  useConnectedDeviceDirectoryInvalidation();
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

  useOperationErrorNotification(operationError, pushNotification);

  useExplorerKeyboardShortcuts({
    navigate,
    shortcutMapRef,
    executableCommandIdsRef,
    pluginCommandsRef,
  });

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
  const handleGrantLocalFolder = useAndroidLocalFolderGrant({
    homePath,
    refreshAndroidAllFilesAccess,
    refreshAndroidGrantedFolders,
  });
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
      props.workspaceId,
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
  const renderAddTabControl = useMemo(() => createExplorerAddTabControl(homePath), [homePath]);
  if (!explorerInitialized || !hasExplorerTabs) return <ExplorerLoadingShell />;
  return (
    <ExplorerDragProvider>
      <section
        ref={workspaceRef}
        className={cx(
          explorerShellStyles.workspaceBase,
          !sidebarVisible && explorerShellStyles.workspaceCollapsed,
        )}
      >
        <main ref={mainRef} className={explorerShellStyles.main}>
          <ExplorerMultiPanelWorkspace
            className="explorer-multipanel"
            canCloseTab={(tab) => canCloseExplorerTab(tab, useMultiPanelStore.getState().tabs)}
            renderBottomBar={resolveExplorerBottomBarRenderer(props.embedded)}
            renderAddTabControl={renderAddTabControl}
            renderTabActions={renderTabActions}
            renderToolbar={renderToolbar}
            showTabStrip={!props.embedded}
            showDefaultPaneControls={false}
            renderNavigationAside={explorerSidebar}
            navigationAsideWidth={sidebarWidth}
            onNavigationAsideResizeStart={startSidebarResize}
            navigationAsideResizing={resizeTarget === "sidebar"}
            renderAside={inspector}
            asideWidth={previewWidth}
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
