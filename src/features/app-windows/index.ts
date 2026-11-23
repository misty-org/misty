export * from "./panes/dock_registry";
export * from "./panes/dock_tree";
export * from "./panes/layout_tabs";
export * from "./tabs/workspace_views";
export * from "./panes/pane_navigation";
export * from "./tabs/account_scope";
export * from "./profiles/profile_window";
export * from "./tabs/space_window";
export * from "./tabs/route_surface";
export { useWindowDockingLayout } from "./panes/use_window_docking_layout";
export * from "./tabs/use_workspace_store";
export { useFocusedPaneHistory } from "./panes/use_focused_pane_history";
export * from "./tabs/use_workspace_view_title";
export * from "./tabs/WorkspaceAppIcon";
export * from "./tabs/workspace_default_view";
export * from "./tabs/workspace_view_operations";
export * from "./tabs/WorkspaceViewRouteScope";

export { StablePaneLayout } from "./panes/StablePaneLayout";
export { dockLeaves, dockTreeViews } from "./panes/dock_tree";
export {
  activeLayoutView,
  allLayoutPanes,
  allLayoutViews,
  isEmptyTab,
  layoutTabs,
  paneViewLabel,
  tabLabel,
  workspaceTabsById,
} from "./panes/layout_tabs";
export { liftPanePresentation } from "./panes/pane_drag_presentation";
export { MAX_PANE_DIM, selectPaneFocusPreferences } from "./panes/pane_focus";
export { panePlacement } from "./panes/pane_placement";
export { usePaneSwapMode, type PaneSwapDirection } from "./panes/pane_swap_mode";
export { useLayoutEditor } from "./panes/layout_editor";
export { draftAdd, draftPlace, draftRemove } from "./panes/layout_draft";
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
} from "./profiles/profile_window";
export { currentWindows } from "./profiles/windows";
export { UnsavedQuitGuard } from "./recovery/UnsavedQuitGuard";
export {
  continueWithTemporaryWorkspace,
  useWorkspaceRecoveryState,
} from "./recovery/native_workspace_recovery";
export { flushWorkspaceRecovery } from "./recovery/recovery_storage";
export { reserveMistyUpdate } from "./recovery/unsaved_changes";
export { useWorkspaceRecoveryRetry } from "./recovery/use_workspace_recovery_retry";
export { nativeWorkspaceRecoveryEnabled } from "./recovery/workspace_recovery_platform";

export { workspaceAppIcon } from "./tabs/WorkspaceAppIcon";
export {
  releaseWorkspaceViewRouteHistory,
  useWorkspaceViewFocused,
  useWorkspaceViewId,
  useWorkspaceViewShown,
} from "./tabs/WorkspaceViewRouteScope";
export { accountScopeFor, localAccountScope } from "./tabs/account_scope";
export {
  browserFaviconUrl,
  type DockSplitDirection,
  type WorkspaceDockNode,
  type WorkspaceLayout,
  type WorkspaceTab,
  type WorkspaceView,
} from "./tabs/workspace_views";
export { isRetiredWebRoute, workspaceSurfaceFromRoute } from "./tabs/route_surface";
export {
  onSpaceWindowSwitch,
  spaceWindow,
  switchSpaceWindow,
  useSpaceWindowStore,
  type SpaceWindowIdentity,
} from "./tabs/space_window";
export { useWorkspaceStore } from "./tabs/use_workspace_store";

export { AdvancedSection } from "./settings/AdvancedSection";
export { AccessibilitySection } from "./settings/AccessibilitySection";
export { AppearanceSection } from "./settings/AppearanceSection";

export {
  browserBlockingOverlayOpen,
  browserNoticeRects,
} from "./page-runtime/browser_blocking_overlay";
export {
  browserOverlayReady,
  isBrowserLayoutMoving,
  reconcileBrowserOverlayState,
  setBrowserNoticeRects,
  setBrowserPointerGestureActive,
  setBrowserPointerTrackingEnabled,
  setBrowserWebviewsSuspended,
} from "./page-runtime/browser_overlay_runtime";
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
} from "./page-runtime/browser_runtime_sets";
export { useBrowserRuntimeStore } from "./page-runtime/browser_runtime_store";
export {
  cancelDeferredHide,
  completeHandoff,
  deferHideUntilHandoff,
  hasPendingHandoff,
  markBrowserPerf,
  onBrowserSettled,
} from "./page-runtime/browser_switch_handoff";
export { type BrowserBounds, type BrowserTheme } from "./page-runtime/page_runtime_types";

export { startProfileWindow } from "./profiles/profile_window";

export { browserHomeUrl } from "./addresses/browser_home";
export {
  preferredDefaultSpace,
  spacesDirectory,
  spacesSnapshot,
  useSpacesDirectory,
  windowSpace,
  type SpaceSummary,
} from "./space-directory/space_directory";
export { MenuBarSection } from "./settings/MenuBarSection";
export { TrayVisibility } from "./TrayVisibility";
