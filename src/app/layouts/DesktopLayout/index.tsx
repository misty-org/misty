import { CursorCompanionController } from "@/features/agents";
import { CapturePanel, DictationController } from "@/features/voice";
import { RecallRecorderMount } from "@/features/recall";
import { type AppTab } from "@/features/app-shell";
import { useAuth } from "@/features/auth";
import { useExtensionsRuntime } from "@/features/extensions/useExtensionsRuntime";
import { ExtensionPermissionRequest } from "@/features/extensions/ExtensionPermissionRequest";
import { ExtensionInstallRequest } from "@/features/extensions/ExtensionInstallRequest";
import { SpaceImportRequest } from "@/features/browser-import/SpaceImportRequest";
import { BrowserSyncBadge, SyncMenuItem } from "@/features/browser-workspace/BrowserSyncBadge";
import { NavigationNamesBoundary } from "@/features/navigation-names/NavigationNamesBoundary";
import { blockIfUnsaved, useSettingsStore } from "@/features/settings";
import {
  setBrowserWebviewsSuspended,
  windowChromeChangedEvent,
} from "@/features/webviews/browserRuntime";
import { useWindowDockingLayout } from "@/features/workspace";
import { windowChromeBackground } from "@/features/workspace/windowColors";
import { useSpaceWindowStore } from "@/features/workspace/spaceWindow";
import { appZoomRenderScale, useAppZoomValue } from "@/shared/hooks/useAppZoom";
import { cn } from "@/shared/ui";
import { useEffect, useRef, useState } from "react";
import { Outlet } from "react-router-dom";
import "./docking.css";
import { isTopEdgeDragPress } from "./windowChromeHelpers";
import { useDockingTransition } from "./useDockingTransition";
import { DesktopShellOverlays } from "./DesktopShellOverlays";
import { FramePacingOverlay } from "./FramePacingOverlay";
import { AccountIsland } from "./AccountIsland";
import { StripDownloads } from "./WorkspaceStripDock";
import { AppNoticePublisher, RouteNotice } from "./RouteNotices";
import { StandaloneRouteSurface } from "./StandaloneRouteSurface";
import * as styles from "./styles";
import { useDesktopBootstrap } from "./useDesktopBootstrap";
import { useDesktopFrameStyle } from "./useDesktopFrameStyle";
import { useDesktopRouteEffects } from "./useDesktopRouteEffects";
import { useDesktopShellStatus } from "./useDesktopShellStatus";
import { useDesktopShortcuts } from "./useDesktopShortcuts";
import { useDesktopTitlebarGeometry } from "./useDesktopTitlebarGeometry";
import { useDesktopWindowChrome } from "./useDesktopWindowChrome";
import { useOtherWindowsHiddenWhileAddingAccount, useSignedOutWindow } from "./useSignedOutWindow";
import { useStrayBrowserPages } from "./useStrayBrowserPages";
import { useFocusModeShortcuts } from "./useFocusModeShortcuts";
import { useSettingsOverlay } from "./useSettingsOverlay";
import { WindowsTitlebarControls } from "./WindowsTitlebarControls";
import { useCaptionSlot } from "./useCaptionSlot";
import { useSidebarCollapsedStore } from "@/features/app-shell/sidebarCollapsed";
import { WorkspaceCanvas } from "./WorkspaceCanvas";
export type {
  AppNoticeEntry,
  AppNoticeKind,
  AppNoticeSource,
  DesktopPlatform,
  FramePacingState,
  WindowBounds,
  WindowRect,
} from "@/app/layouts/model";

export function DesktopLayout(props: { getRouteId: (pathname: string) => AppTab }) {
  useExtensionsRuntime();
  useStrayBrowserPages();
  const { user, refreshUser, transitioning } = useAuth();
  const { location, navigate, settingsLoad, lastAppRoute, lastNonSettingsRouteRef, routeId } =
    useDesktopBootstrap({ getRouteId: props.getRouteId });
  const {
    shouldShowWindowsTitlebarControls,
    isWindowMaximized,
    handleDesktopTitlebarPointerDown,
    handleTopEdgePointerDown,
    toggleTitlebarMaximize,
    minimizeTitlebarWindow,
    closeTitlebarWindow,
    showSnapLayoutsSoon,
    cancelSnapLayouts,
  } = useDesktopWindowChrome();
  const appZoom = appZoomRenderScale(useAppZoomValue());
  useDesktopFrameStyle();

  const framePacingOverlayEnabled = useDesktopShellStatus();

  const [profileOpen, setProfileOpen] = useState(false);
  const docking = useWindowDockingLayout();
  const focusMode = useFocusModeShortcuts();
  const {
    settingsOpen,
    setSettingsOpen,
    openSettingsOverlay,
    closeSettingsOverlay,
    openAccountSettings,
  } = useSettingsOverlay({ settingsLoad, refreshUser });
  useDesktopRouteEffects({
    userId: user?.id,
    transitioning,
    location,
    navigate,
    lastAppRoute,
    lastNonSettingsRouteRef,
    openSettingsOverlay,
  });
  useDesktopShortcuts({ navigate, openSettingsOverlay });

  useEffect(() => {
    setBrowserWebviewsSuspended(profileOpen || settingsOpen, "shell-overlay");
    return () => setBrowserWebviewsSuspended(false, "shell-overlay");
  }, [profileOpen, settingsOpen]);

  useEffect(() => setProfileOpen(false), [docking]);
  const shellRef = useRef<HTMLElement>(null);
  useDockingTransition(shellRef, `${docking.navigation}:${docking.tabs}:${focusMode}`);

  const shouldShowWindowsControls = shouldShowWindowsTitlebarControls;
  // The buttons belong to the sidebar's header, like the traffic lights on macOS: they slide
  // away when the sidebar collapses and come back when it peeks out, and never float over the
  // window's corner on their own.
  const captionSlot = useCaptionSlot(shellRef, shouldShowWindowsControls);
  const sidebarCollapsed = useSidebarCollapsedStore((state) => state.collapsed);
  const {
    isAuthRoute,
    standaloneRouteTitle,
    windowsTitlebarControlsRef,
    titlebarNavigationGeometry,
    geometry,
  } = useDesktopTitlebarGeometry({
    shellRef,
    pathname: location.pathname,
    docking,
    focusMode,
    shouldShowWindowsControls,
    captionInline: Boolean(captionSlot),
    appZoom,
  });
  useSignedOutWindow(isAuthRoute);
  // Over the window's corner only where no sidebar can hold them: sign-in, or a page that
  // shows no sidebar. A collapsed sidebar takes them away with it.
  const floatingCaption = isAuthRoute || !sidebarCollapsed;
  useOtherWindowsHiddenWhileAddingAccount(
    isAuthRoute && Boolean((location.state as { addingAccount?: boolean } | null)?.addingAccount),
  );
  // The window takes its Space's color, which tints everything around the content region.
  const windowChrome = useSpaceWindowStore((state) => windowChromeBackground(state.space?.color));
  useEffect(() => {
    const shell = shellRef.current;
    if (windowChrome && !isAuthRoute)
      shell?.style.setProperty("--misty-window-chrome", windowChrome);
    else shell?.style.removeProperty("--misty-window-chrome");
    // Pages smooth their rounded corners with this color; let them measure it again.
    window.dispatchEvent(new Event(windowChromeChangedEvent));
  }, [windowChrome, isAuthRoute]);
  const openSyncSettings = () => {
    useSettingsStore.getState().setActiveSection("sync");
    openSettingsOverlay();
  };
  // Sync is a button next to Settings, under the tabs.
  const syncButton = (
    <BrowserSyncBadge key={user?.id} accountId={user?.id ?? ""} onOpenSettings={openSyncSettings} />
  );
  const stripAccount = !isAuthRoute ? (
    <AccountIsland
      open={profileOpen}
      onOpenChange={(open) => {
        if (open) {
          if (blockIfUnsaved()) return;
          setSettingsOpen(false);
        }
        setProfileOpen(open);
      }}
      onOpenAccountSettings={openAccountSettings}
      settingsOpen={settingsOpen || location.pathname.startsWith("/settings")}
      onSettingsClick={openSettingsOverlay}
      sync={syncButton}
    />
  ) : null;
  // The sidebar's bottom edge: downloads on the left, chat on the right.
  const stripFootEnd = (
    <>
      <StripDownloads />
    </>
  );
  const browserChrome = {
    accountItems: <SyncMenuItem accountId={user?.id ?? ""} />,
  };
  return (
    <NavigationNamesBoundary userId={user?.id ?? ""} enabled={!isAuthRoute}>
      <ExtensionPermissionRequest />
      <ExtensionInstallRequest />
      <SpaceImportRequest />
      <main
        ref={shellRef}
        className={cn(
          "misty-docking-frame",
          "transition-[grid-template-columns,grid-template-rows]",
          styles.navigatorMotionClass,
        )}
        style={
          isAuthRoute
            ? { gridTemplateColumns: "minmax(0, 1fr)", gridTemplateRows: "38px minmax(0, 1fr)" }
            : geometry.frame
        }
        data-misty-desktop-frame
        data-rail-flush={!isAuthRoute && geometry.railFlush ? "true" : undefined}
        data-navigation-position={docking.navigation}
        data-tab-position={docking.tabs}
        onPointerDown={(event) => {
          const target = event.target instanceof Element ? event.target : null;
          if (target?.closest("[data-misty-window-titlebar-region='true']")) {
            handleDesktopTitlebarPointerDown(event);
            return;
          }
          // Pages drawn by the app itself move the window from their top edge too, as native
          // browser pages do. Portalled menus and dialogs sit outside this element.
          if (shellRef.current?.contains(target) && isTopEdgeDragPress(event))
            handleTopEdgePointerDown(event);
        }}
      >
        <header
          className={cn("misty-docking-titlebar", isAuthRoute && "border-b-0 bg-transparent")}
          data-shared-chrome={!isAuthRoute}
          onPointerDown={handleDesktopTitlebarPointerDown}
        >
          {shouldShowWindowsControls && (captionSlot || floatingCaption) ? (
            <WindowsTitlebarControls
              slot={captionSlot}
              controlsRef={windowsTitlebarControlsRef}
              scale={titlebarNavigationGeometry.scale}
              isWindowMaximized={isWindowMaximized}
              minimizeTitlebarWindow={minimizeTitlebarWindow}
              closeTitlebarWindow={closeTitlebarWindow}
              toggleTitlebarMaximize={toggleTitlebarMaximize}
              showSnapLayoutsSoon={showSnapLayoutsSoon}
              cancelSnapLayouts={cancelSnapLayouts}
            />
          ) : null}
        </header>

        <section
          className={cn(
            "route-shell relative z-10 min-h-0 min-w-0 overflow-hidden",
            isAuthRoute ? "bg-window-chrome" : "bg-charcoal-bg",
          )}
          style={isAuthRoute ? { gridColumn: 1, gridRow: 2 } : geometry.content}
          data-misty-route-shell
        >
          {!isAuthRoute ? <AppNoticePublisher /> : null}
          {!isAuthRoute ? <RouteNotice routeId={routeId} /> : null}

          <>
            {isAuthRoute ? (
              <Outlet />
            ) : standaloneRouteTitle ? (
              <StandaloneRouteSurface title={standaloneRouteTitle}>
                <Outlet />
              </StandaloneRouteSurface>
            ) : (
              <WorkspaceCanvas
                windowsTitlebarControls={shouldShowWindowsControls}
                tabPosition={docking.tabs}
                hideTabStrip={focusMode}
                stripFootEnd={stripFootEnd}
                stripAccount={stripAccount}
                browserChrome={browserChrome}
              />
            )}
            {!isAuthRoute && user?.id ? (
              <>
                <CursorCompanionController key={user.id} accountId={user.id} />
                <DictationController key={`dictation-${user.id}`} />
                <CapturePanel key={`capture-${user.id}`} />
                <RecallRecorderMount key={`recall-${user.id}`} />
              </>
            ) : null}
          </>
        </section>

        <FramePacingOverlay enabled={!isAuthRoute && framePacingOverlayEnabled} />
        {!isAuthRoute ? (
          <DesktopShellOverlays
            settingsOpen={settingsOpen}
            onCloseSettings={closeSettingsOverlay}
            userId={user?.id}
          />
        ) : null}
      </main>
    </NavigationNamesBoundary>
  );
}
