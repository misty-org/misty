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
export { useWindowDockingLayout } from "./panes/useWindowDockingLayout";
export * from "./tabs/useWorkspaceStore";
export { useFocusedPaneHistory } from "./panes/useFocusedPaneHistory";
export * from "./tabs/useWorkspaceViewTitle";
export * from "./tabs/WorkspaceAppIcon";
export * from "./tabs/workspaceDefaultView";
export * from "./tabs/workspaceViewOperations";
export * from "./tabs/WorkspaceViewRouteScope";

// What other features import from here.
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
export { nativeWorkspaceRecoveryEnabled } from "./recovery/workspaceRecoveryPlatform";
export { MistyBrandIcon } from "./tabs/MistyBrandIcon";

export { workspaceAppIcon } from "./tabs/WorkspaceAppIcon";
export {
  releaseWorkspaceViewRouteHistory,
  useWorkspaceViewFocused,
  useWorkspaceViewId,
  useWorkspaceViewShown,
} from "./tabs/WorkspaceViewRouteScope";
export { accountScopeFor, localAccountScope } from "./tabs/accountScope";
export {
  browserFaviconUrl,
  type DockSplitDirection,
  type WorkspaceDockNode,
  type WorkspaceLayout,
  type WorkspaceTab,
  type WorkspaceView,
} from "./tabs/workspaceViews";
export { isRetiredWebRoute, workspaceSurfaceFromRoute } from "./tabs/routeSurface";
export {
  onSpaceWindowSwitch,
  spaceWindow,
  switchSpaceWindow,
  useSpaceWindowStore,
  type SpaceWindowIdentity,
} from "./tabs/spaceWindow";
export { useWorkspaceStore } from "./tabs/useWorkspaceStore";

// What other features import from here.
export { AdvancedSection } from "./settings/AdvancedSection";
export { AppearanceSection } from "./settings/AppearanceSection";

// What other features import from here.
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
export {
  adoptedPages,
  browserRuntimeResumeEvent,
  desiredVisibleRuntimeIds,
  enqueue,
  hideRequest,
  keepLiveRuntimeIds,
  lastBounds,
  runtimeQueues,
  serializeBounds,
  setBrowserPagePresented,
  setBrowserRuntimeKeepLive,
  visibleRuntimeIds,
} from "./page-runtime/browserRuntimeSets";
export { useBrowserRuntimeStore } from "./page-runtime/browserRuntimeStore";
export {
  cancelDeferredHide,
  completeHandoff,
  deferHideUntilHandoff,
  hasPendingHandoff,
  markBrowserPerf,
  onBrowserSettled,
} from "./page-runtime/browserSwitchHandoff";
export { type BrowserBounds, type BrowserTheme } from "./page-runtime/pageRuntimeTypes";

// What other features import from here.
export { startProfileWindow } from "./profiles/profileWindow";

// What other features import from here.
export { browserHomeUrl } from "./addresses/browserHome";
export {
  preferredDefaultSpace,
  spacesDirectory,
  spacesSnapshot,
  useSpacesDirectory,
  windowSpace,
  type SpaceSummary,
} from "./space-directory/spaceDirectory";
