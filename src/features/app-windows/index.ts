export * from "./panes/dockRegistry";
export * from "./panes/dockTree";
export * from "./panes/layoutTabs";
export * from "./tabs/MistyBrandIcon";
export * from "./tabs/workspaceViews";
export * from "./panes/paneNavigation";
export * from "./tabs/accountScope";
export * from "./profiles/profileWindow";
export * from "./tabs/spaceWindow";
export * from "./tabs/routeSurface";
export { isUnseenPreload, mayPreload } from "./tabs/tabPreload";
export { useWindowDockingLayout } from "./panes/useWindowDockingLayout";
export * from "./tabs/useWorkspaceStore";
export { useFocusedPaneHistory } from "./panes/useFocusedPaneHistory";
export * from "./tabs/useWorkspaceViewTitle";
export * from "./tabs/WorkspaceAppIcon";
export * from "./tabs/workspaceDefaultView";
export * from "./tabs/workspaceViewOperations";
export * from "./tabs/WorkspaceViewRouteScope";

// Public surface used by other features (generated from their imports).
export { NavigationNamesBoundary } from "./navigation-names/NavigationNamesBoundary";
export { useNavigationNames } from "./navigation-names/store";
export { StablePaneLayout } from "./panes/StablePaneLayout";
export { dockLeaves, dockTreeViews } from "./panes/dockTree";
export {
  activeLayoutView,
  allLayoutPanes,
  allLayoutViews,
  isEmptyTab,
  layoutTabs,
  paneViewLabel,
  tabLabel,
  workspaceTabsById,
} from "./panes/layoutTabs";
export { liftPanePresentation } from "./panes/paneDragPresentation";
export { MAX_PANE_DIM, selectPaneFocusPreferences } from "./panes/paneFocus";
export { panePlacement } from "./panes/panePlacement";
export { usePaneSwapMode, type PaneSwapDirection } from "./panes/paneSwapMode";
export { useLayoutEditor } from "./panes/layoutEditor";
export { draftAdd, draftPlace, draftRemove } from "./panes/layoutDraft";
export {
  closeWindow,
  currentProfile,
  currentWindowId,
  firstProfileId,
  isHostWindow,
  isLinkTargetWindow,
  isProfileWindowLabel,
  onHostWindow,
  openNewWindow,
  useProfileWindowStore,
  type ProfileEntry,
} from "./profiles/profileWindow";
export { currentWindows } from "./profiles/windows";
export { UnsavedQuitGuard } from "./recovery/UnsavedQuitGuard";
export {
  continueWithTemporaryWorkspace,
  useWorkspaceRecoveryState,
} from "./recovery/nativeWorkspaceRecovery";
export { flushWorkspaceRecovery } from "./recovery/recoveryStorage";
export { reserveMistyUpdate } from "./recovery/unsavedChanges";
export { useWorkspaceRecoveryRetry } from "./recovery/useWorkspaceRecoveryRetry";
export { migrateRetiredWorkspaceView } from "./recovery/workspaceMigrations";
export { nativeWorkspaceRecoveryEnabled } from "./recovery/workspaceRecoveryPlatform";
export { MistyBrandIcon } from "./tabs/MistyBrandIcon";

export { workspaceAppIcon } from "./tabs/WorkspaceAppIcon";
export {
  releaseWorkspaceViewRouteHistory,
  useWorkspaceViewFocused,
} from "./tabs/WorkspaceViewRouteScope";
export { accountScopeFor, localAccountScope } from "./tabs/accountScope";
export {
  blankBrowserUrl,
  parseBrowserViewState,
  type DockSplitDirection,
  type WorkspaceDockNode,
  type WorkspaceLayout,
  type WorkspaceTab,
  type WorkspaceView,
} from "./tabs/workspaceViews";
export { type PageDocument } from "./tabs/pageSnapshot";
export { isRetiredWebRoute, workspaceSurfaceFromRoute } from "./tabs/routeSurface";
export {
  onSpaceWindowSwitch,
  spaceWindow,
  switchSpaceWindow,
  useSpaceWindowStore,
  type SpaceWindowIdentity,
} from "./tabs/spaceWindow";
export { useWorkspacePagePreview } from "./tabs/useWorkspacePagePreview";
export { useWorkspaceStore } from "./tabs/useWorkspaceStore";
export {
  configureWorkspaceDefaultView,
  workspaceDefaultViewIndex,
} from "./tabs/workspaceDefaultView";

// Public surface used by other features (generated from their imports).
export { AdvancedSection } from "./settings/AdvancedSection";
export { AppearanceSection } from "./settings/AppearanceSection";

// Public surface used by other features (generated from their imports).
export {
  browserBlockingOverlayOpen,
  browserNoticeRects,
} from "./page-runtime/browserBlockingOverlay";
export {
  browserOverlayReady,
  isBrowserLayoutMoving,
  reconcileBrowserOverlayState,
  setBrowserNoticeRects,
  setBrowserPointerGestureActive,
  setBrowserPointerTrackingEnabled,
  setBrowserWebviewsSuspended,
} from "./page-runtime/browserOverlayRuntime";
export { savePagePreview } from "./page-runtime/browserPagePreview";
export {
  adoptedPages,
  browserRuntimeCreated,
  browserRuntimeId,
  browserRuntimeResumeEvent,
  browserScopeId,
  browserSyncStates,
  browserTabIdForRuntime,
  closedRuntimes,
  createdRuntimeIds,
  desiredVisibleRuntimeIds,
  enqueue,
  hideRequest,
  keepLiveRuntimeIds,
  lastBounds,
  parkGeneration,
  registerBrowserRuntime,
  runtimeQueues,
  runtimeTabIds,
  serializeBounds,
  setBrowserPagePresented,
  setBrowserRuntimeKeepLive,
  visibleRuntimeIds,
  type BrowserRuntimeTab,
  type BrowserSyncInput,
  type BrowserSyncState,
} from "./page-runtime/browserRuntimeSets";
export { useBrowserRuntimeStore } from "./page-runtime/browserRuntimeStore";
export {
  type BrowserHistory,
  type BrowserInspection,
  type BrowserMistyPage,
} from "./page-runtime/browserRuntimeTypes";
export {
  cancelDeferredHide,
  completeHandoff,
  deferHideUntilHandoff,
  hasPendingHandoff,
  markBrowserPerf,
  onBrowserSettled,
} from "./page-runtime/browserSwitchHandoff";
export { isMediaHeld } from "./page-runtime/mediaHold";
export { type BrowserBounds, type BrowserTheme } from "./page-runtime/pageRuntimeTypes";

// Public surface used by other features (generated from their imports).
export { startProfileWindow } from "./profiles/profileWindow";

// Public surface used by other features (generated from their imports).
export { browserHomeUrl } from "./addresses/browserHome";
export {
  preferredDefaultSpace,
  spacesDirectory,
  spacesSnapshot,
  useSpacesDirectory,
  windowSpace,
  type SpaceSummary,
} from "./space-directory/spaceDirectory";
