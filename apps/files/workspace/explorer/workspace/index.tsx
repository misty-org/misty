import { createFilesAiAdapter } from "../../createFilesAiAdapter";
import {
  routes,
  useAppRouteMemoryStore,
  useAppStore,
} from "@/features/app-shell";
import {
  ProvidersWorkspacePanel,
  useProvidersStore,
} from "@/features/providers";
import {
  selectAdvancedPreferences,
  selectFilePreferences,
  selectGeneralPreferences,
  useSettingsStore,
} from "@/features/settings";
import { dockLeaves, useWorkspaceStore } from "@/features/workspace";
import { useAiSurfaceAdapter } from "@/features/ai-surface/AiPaneHost";
import { useTransientScrollbars } from "@/shared/hooks/useTransientScrollbars";
import {
  isAndroidBuild,
  isNativeMobileBuild,
  isWebBuild,
} from "@/shared/platform/buildTarget";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { ChromeTabShell } from "./ChromeTabShell";
import { ExplorerLoadingShell } from "../components/ExplorerLoadingShell";
import { ExplorerPane } from "../components/ExplorerPane";
import { ExplorerSidebar } from "../components/ExplorerSidebar";
import { libraryWorkspacePath } from "../components/LibraryWorkspace";
import { ComingSoonSurface } from "@/shared/ui";
import { ExplorerDragProvider } from "../drag/ExplorerDragContext";
import { selectedPathsForPane, useExplorerStore } from "../store";
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
  parsePluginTabPath,
} from "./ExplorerDesktopPlugins";
import { cx } from "./ExplorerDesktopShared";
import {
  ExplorerNotifications,
  ExplorerRenameStatus,
} from "./ExplorerDesktopStatus";
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
import { useFilesDockWorkspace } from "./explorerWorkspace/useFilesDockWorkspace";
import { filesMultiPanelStore } from "./explorerWorkspace/filesDockStores";
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
export const ExplorerWorkspace = memo(function ExplorerWorkspace(
  props: ExplorerWorkspaceProps,
) {
  const navigate = useNavigate();
  const multiPanelStore = useMemo(
    () => filesMultiPanelStore(props.workspaceId),
    [props.workspaceId],
  );
  const workspaceFocused = useWorkspaceStore((state) => {
    if (props.active === false) return false;
    if (!props.workspaceId) return true;
    const pane = dockLeaves(state.layout.root).find(
      (candidate) => candidate.id === state.layout.focusedPaneId,
    );
    return pane?.activeTabId === props.workspaceId;
  });
  const app = useAppStore((state) => state.app);
  const {
    sidebarWidth,
    previewWidth,
    pinnedPaths,
    library,
    operationError,
    inlineEdit,
    explorerDialogPaneId,
    contextMenuPaneId,
    notifications,
    pushNotification,
    dismissNotification,
  } = useExplorerStore(
    useShallow((state) => ({
      sidebarWidth: state.sidebarWidth,
      previewWidth: state.previewWidth,
      pinnedPaths: state.pinnedPaths,
      library: state.library,
      operationError: state.operationError,
      inlineEdit: state.inlineEdit,
      explorerDialogPaneId: state.dialog?.paneId ?? "",
      contextMenuPaneId: state.contextMenu.paneId,
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
  } = multiPanelStore(
    useShallow((state) => {
      const activeTab =
        state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0];
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
  const { preferredWorkspaceRoot, settingsLoaded, settingsMountPath } =
    useSettingsStore(
      useShallow((state) => ({
        preferredWorkspaceRoot: selectGeneralPreferences(
          state.settings?.document,
        ).preferredWorkspaceRoot,
        settingsMountPath: selectAdvancedPreferences(state.settings?.document)
          .mountPath,
        settingsLoaded: state.loaded,
      })),
    );
  const filePreferences = useSettingsStore(
    useShallow((state) => selectFilePreferences(state.settings?.document)),
  );

  useEffect(() => {
    // Seeds the store-wide defaults a freshly opened pane inherits. Per-pane
    // overrides from the toolbar live in `paneViewModes`/`paneShowHidden` and
    // keep winning, so changing the default never yanks an open pane around.
    if (!settingsLoaded) return;
    useExplorerStore.setState({
      showHidden: filePreferences.showHiddenFiles,
      viewMode: filePreferences.defaultViewModeIndex === 1 ? "grid" : "list",
    });
  }, [
    filePreferences.defaultViewModeIndex,
    filePreferences.showHiddenFiles,
    settingsLoaded,
  ]);
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
  const activeSelectedPath = useExplorerStore(
    (state) => selectedPathsForPane(state.panes[activePaneId])[0] ?? "",
  );
  const activePane = useExplorerStore((state) => state.panes[activePaneId]);
  const aiAdapter = useMemo(
    () =>
      createFilesAiAdapter({
        viewId: `${props.workspaceId ?? "files"}:${activePaneId}`,
        canMutate: !isAndroidBuild,
        selected: () => {
          const pane = useExplorerStore.getState().panes[activePaneId];
          const ids = new Set(pane?.selectedIds ?? []);
          return (pane?.listing?.entries ?? []).filter((entry) =>
            ids.has(entry.id),
          );
        },
        rename: (_entry, name) =>
          useExplorerStore.getState().renameSelected(activePaneId, name),
        trash: () =>
          useExplorerStore.getState().deleteSelected(activePaneId, "trash"),
      }),
    [activePane, activePaneId, props.workspaceId],
  );
  useAiSurfaceAdapter(aiAdapter);
  const explorerInitialized = useExplorerStore((state) => state.initialized);
  const openSidebarPathInNewTab = useFilesDockWorkspace({
    workspaceId: props.workspaceId,
    activePaneId,
    activePath,
    initialized: explorerInitialized,
    embedded: props.embedded,
    homePath,
    multiPanelStore,
    navigate,
  });

  // Extension execution depends on Misty's desktop-native runtime. Keep the
  // launcher active on desktop while leaving unsupported mobile/web builds out.
  const extensionsEnabled = !isNativeMobileBuild && !isWebBuild;
  useLegacyPluginTabMigration({
    extensionsEnabled,
    homePath,
    navigate,
    workspacePathSignature,
    multiPanelStore,
  });
  const activePaneIdRef = useRef(activePaneId);
  const activePathRef = useRef(activePath);
  const {
    pluginCommands,
    pluginPanels,
    executableCommandIdsRef,
    pluginCommandsRef,
  } = usePluginRegistry({ extensionsEnabled });
  const ownsPane = useCallback(
    (paneId: string) =>
      multiPanelStore
        .getState()
        .tabs.some((tab) => tab.panes.some((pane) => pane.id === paneId)),
    [multiPanelStore],
  );
  const {
    duplicateFinderPaneId,
    setDuplicateFinderPaneId,
    compareDialog,
    setCompareDialog,
  } = useExplorerDialogEvents(activePaneIdRef, ownsPane);
  useTransferRefreshPolling(mountRoot);
  useConnectedDeviceDirectoryInvalidation();
  const {
    resizeTarget,
    resizeSidebarBy,
    resizePreviewBy,
    startSidebarResize,
    startPreviewResize,
  } = usePanelResize({
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
    ensureFilesBrowseTab(homePath, multiPanelStore);
  }, [homePath, multiPanelStore, workspacePathSignature]);
  useEffect(() => {
    activePaneIdRef.current = activePaneId;
    activePathRef.current = activePath;
  }, [activePaneId, activePath]);

  useScopedExplorerWorkspace(props, homePath, settingsLoaded);

  useOperationErrorNotification(operationError, pushNotification);

  useExplorerKeyboardShortcuts({
    active: props.active,
    navigate,
    executableCommandIdsRef,
    pluginCommands,
    pluginCommandsRef,
    multiPanelStore,
    workspaceId: props.workspaceId,
  });

  const navigateSidebar = useCallback(
    (path: string) => {
      const paneId = multiPanelStore.getState().activePaneId;
      if (paneId) void useExplorerStore.getState().navigatePane(paneId, path);
    },
    [multiPanelStore],
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
    [
      extensionsEnabled,
      locationResults,
      navigate,
      pluginCommands,
      pluginPanels,
    ],
  );
  const renderPane = useCallback(
    (paneId: string, path: string) => {
      // The dock supplies the tab strip, not the pane's own controls, so these
      // belong to the embedded view just as much as the standalone route.
      const paneActions =
        activePaneId === paneId ? (
          <div className="flex items-center gap-1">
            <ExplorerPaneHeaderActions
              paneId={paneId}
              multiPanelStore={multiPanelStore}
              extensionsEnabled={extensionsEnabled}
              pluginCommands={pluginCommands}
              pluginPanels={pluginPanels}
              selectedPath={activeSelectedPath}
            />
          </div>
        ) : undefined;
      if (isRemotesTabPath(path)) {
        return (
          <ChromeTabShell
            embedded={props.embedded}
            label="Remotes"
            homePath={homePath}
          >
            <ProvidersWorkspacePanel workspaceId={paneId} />
          </ChromeTabShell>
        );
      }
      if (path === libraryWorkspacePath) {
        return <ComingSoonSurface feature="Smart Library" />;
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
    [
      activePaneId,
      activeSelectedPath,
      extensionsEnabled,
      homePath,
      multiPanelStore,
      pluginCommands,
      pluginPanels,
      props.embedded,
    ],
  );
  const { inspector } = useExplorerAgentDock({
    activePaneId,
    activePath,
    fallbackInspector: previewVisible ? (
      <ConnectedFileInspector paneId={activePaneId} />
    ) : undefined,
  });
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
    multiPanelStore,
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
          onNavigate={navigateSidebar}
          onRefreshDevices={refreshDevices}
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
      androidAllFilesAccess,
      androidGrantedFolders,
      devicesLoading,
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
    ],
  );
  const renderTabActions = useCallback(
    () =>
      props.workspaceId ? null : (
        <ExplorerTray
          onToggleFileManagerMode={() =>
            navigate(useAppRouteMemoryStore.getState().lastSpacesRoute)
          }
          terminalEnabled={
            activeTabSupportsSidePanels &&
            canOpenTerminalPath(activeTabPath) &&
            canOpenTerminalPath(activePath)
          }
          terminalPath={activePath}
        />
      ),
    [
      activePath,
      activeTabPath,
      activeTabSupportsSidePanels,
      navigate,
      props.workspaceId,
    ],
  );
  const renderAddTabControl = useMemo(
    () => createExplorerAddTabControl(homePath),
    [homePath],
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
      >
        <main ref={mainRef} className={explorerShellStyles.main}>
          <ExplorerMultiPanelWorkspace
            store={multiPanelStore}
            className="explorer-multipanel"
            canCloseTab={(tab) =>
              canCloseExplorerTab(tab, multiPanelStore.getState().tabs)
            }
            renderBottomBar={resolveExplorerBottomBarRenderer(props.embedded)}
            renderAddTabControl={renderAddTabControl}
            renderTabActions={renderTabActions}
            renderToolbar={renderToolbar}
            showTabStrip={!props.embedded}
            showDefaultPaneControls={false}
            renderNavigationAside={explorerSidebar}
            navigationAsideWidth={sidebarWidth}
            onNavigationAsideResizeStart={startSidebarResize}
            onNavigationAsideResizeBy={resizeSidebarBy}
            navigationAsideResizing={resizeTarget === "sidebar"}
            renderAside={inspector}
            asideWidth={previewWidth}
            onAsideResizeStart={startPreviewResize}
            onAsideResizeBy={resizePreviewBy}
            asideResizing={resizeTarget === "preview"}
            renderPane={renderPane}
          />
        </main>
        {inlineEdit && ownsPane(inlineEdit.paneId) ? (
          <ExplorerRenameStatus edit={inlineEdit} />
        ) : null}
        {workspaceFocused ? (
          <ExplorerNotifications
            notifications={notifications}
            onDismiss={dismissNotification}
          />
        ) : null}
        {duplicateFinderPaneId ? (
          <DuplicateFinderDialog
            paneId={duplicateFinderPaneId}
            defaultRoot={
              useExplorerStore.getState().panes[duplicateFinderPaneId]?.listing
                ?.path ?? activePath
            }
            onClose={() => setDuplicateFinderPaneId(null)}
          />
        ) : null}
        {compareDialog ? (
          <CompareDialog
            seed={compareDialog}
            onClose={() => setCompareDialog(null)}
          />
        ) : null}
        {ownsPane(contextMenuPaneId) ? <ExplorerContextMenu /> : null}
        {explorerDialogPaneId && ownsPane(explorerDialogPaneId) ? (
          <ExplorerDialog />
        ) : null}
      </section>
    </ExplorerDragProvider>
  );
});

export default ExplorerWorkspace;
