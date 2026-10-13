import { CursorCompanionController } from "@/features/agents";
import { type AppTab } from "@/features/app-shell";
import { useAuth } from "@/features/auth";
import { useExtensionsRuntime } from "@/features/extensions/useExtensionsRuntime";
import { ExtensionPermissionRequest } from "@/features/extensions/ExtensionPermissionRequest";
import { ExtensionInstallRequest } from "@/features/extensions/ExtensionInstallRequest";
import { BrowserSyncBadge } from "@/features/browser-workspace/BrowserSyncBadge";
import { NavigationNamesBoundary } from "@/features/navigation-names/NavigationNamesBoundary";
import { useSettingsStore } from "@/features/settings";
import { setBrowserWebviewsSuspended } from "@/features/webviews/browserRuntime";
import { useWindowDockingLayout } from "@/features/workspace";
import { appZoomRenderScale, useAppZoomValue } from "@/shared/hooks/useAppZoom";
import { cn } from "@/shared/ui";
import { useEffect, useRef, useState } from "react";
import { Outlet } from "react-router-dom";
import "./docking.css";
import { useDockingTransition } from "./useDockingTransition";
import { DesktopShellOverlays } from "./DesktopShellOverlays";
import { FramePacingOverlay } from "./FramePacingOverlay";
import { GlobalNavigator } from "./GlobalNavigator";
import { navigatorRailWidth } from "./navigatorMode";
import { NavigatorRail } from "./NavigatorRail";
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
import { useNavigatorAutoHide } from "./useNavigatorAutoHide";
import { useSettingsOverlay } from "./useSettingsOverlay";
import { WindowsTitlebarControls } from "./WindowsTitlebarControls";
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
  const { user, refreshUser, transitioning } = useAuth();
  const {
    location,
    navigate,
    settingsLoad,
    activePaneId,
    activeWorkspacePaneId,
    lastAppRoute,
    lastNonSettingsRouteRef,
    routeId,
  } = useDesktopBootstrap({ getRouteId: props.getRouteId });
  const {
    shouldShowWindowsTitlebarControls,
    isWindowMaximized,
    startTitlebarDrag,
    handleDesktopTitlebarPointerDown,
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
  const { focusMode, navigatorAutoHide, toggleNavigatorAutoHide } = useNavigatorAutoHide();
  const navigatorWidth = navigatorRailWidth;
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
  useDesktopShortcuts({ navigate, openSettingsOverlay, toggleNavigatorAutoHide });

  useEffect(() => {
    setBrowserWebviewsSuspended(profileOpen || settingsOpen, "shell-overlay");
    return () => setBrowserWebviewsSuspended(false, "shell-overlay");
  }, [profileOpen, settingsOpen]);

  useEffect(() => setProfileOpen(false), [docking]);
  const shellRef = useRef<HTMLElement>(null);
  useDockingTransition(
    shellRef,
    `${docking.navigation}:${docking.tabs}:${navigatorAutoHide}:${focusMode}`,
  );

  const shouldShowWindowsControls = shouldShowWindowsTitlebarControls;
  const {
    isAuthRoute,
    standaloneRouteTitle,
    sharedTitlebar,
    windowsTitlebarControlsRef,
    titlebarNavigationGeometry,
    tabsFollowNavigator,
    geometry,
    topTabInsets,
  } = useDesktopTitlebarGeometry({
    shellRef,
    pathname: location.pathname,
    docking,
    navigatorAutoHide,
    focusMode,
    shouldShowWindowsControls,
    appZoom,
  });
  const navigatorContent = (
    <GlobalNavigator
      syncControl={
        <BrowserSyncBadge
          key={user?.id}
          accountId={user?.id ?? ""}
          onOpenSettings={() => {
            useSettingsStore.getState().setActiveSection("sync");
            openSettingsOverlay();
          }}
        />
      }
      position={docking.navigation}
      profileOpen={profileOpen}
      settingsOpen={settingsOpen || location.pathname.startsWith("/settings")}
      suppressActiveTool={Boolean(standaloneRouteTitle)}
      onProfileOpenChange={(open) => {
        if (open) setSettingsOpen(false);
        setProfileOpen(open);
      }}
      onOpenAccountSettings={openAccountSettings}
      onSettingsClick={openSettingsOverlay}
      onStartWindowDrag={startTitlebarDrag}
    />
  );
  return (
    <NavigationNamesBoundary userId={user?.id ?? ""} enabled={!isAuthRoute}>
      <ExtensionPermissionRequest />
      <ExtensionInstallRequest />
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
        data-navigation-position={docking.navigation}
        data-tab-position={docking.tabs}
        onPointerDown={(event) => {
          const target = event.target instanceof Element ? event.target : null;
          if (!target?.closest("[data-misty-window-titlebar-region='true']")) return;
          handleDesktopTitlebarPointerDown(event);
        }}
      >
        <header
          className={cn("misty-docking-titlebar", isAuthRoute && "border-b-0 bg-transparent")}
          data-shared-tabs={sharedTitlebar}
          data-shared-chrome={!isAuthRoute}
          onPointerDown={handleDesktopTitlebarPointerDown}
        >
          {sharedTitlebar ? (
            <div
              className={cn(
                "misty-docking-titlebar-drag-region",
                "transition-[width]",
                styles.navigatorMotionClass,
              )}
              aria-hidden="true"
              style={{ width: tabsFollowNavigator ? navigatorWidth : topTabInsets?.left }}
            />
          ) : null}
          {shouldShowWindowsControls ? (
            <WindowsTitlebarControls
              controlsRef={windowsTitlebarControlsRef}
              scale={titlebarNavigationGeometry.scale}
              isAuthRoute={isAuthRoute}
              isWindowMaximized={isWindowMaximized}
              minimizeTitlebarWindow={minimizeTitlebarWindow}
              closeTitlebarWindow={closeTitlebarWindow}
              toggleTitlebarMaximize={toggleTitlebarMaximize}
              showSnapLayoutsSoon={showSnapLayoutsSoon}
              cancelSnapLayouts={cancelSnapLayouts}
            />
          ) : null}
        </header>

        {!isAuthRoute ? (
          <NavigatorRail
            autoHide={navigatorAutoHide}
            position={docking.navigation}
            geometry={geometry}
          >
            {navigatorContent}
          </NavigatorRail>
        ) : null}

        <section
          className="route-shell relative z-10 min-h-0 min-w-0 overflow-hidden bg-charcoal-bg"
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
                titlebarInsets={topTabInsets}
                hideTabStrip={focusMode}
              />
            )}
            {!isAuthRoute && user?.id ? (
              <CursorCompanionController key={user.id} accountId={user.id} />
            ) : null}
          </>
        </section>

        {!isAuthRoute ? <></> : null}
        <FramePacingOverlay enabled={!isAuthRoute && framePacingOverlayEnabled} />
        {!isAuthRoute ? (
          <DesktopShellOverlays
            settingsOpen={settingsOpen}
            onCloseSettings={closeSettingsOverlay}
            userId={user?.id}
            currentPath={`${location.pathname}${location.search}`}
            activePaneId={activePaneId}
            activeWorkspacePaneId={activeWorkspacePaneId}
          />
        ) : null}
      </main>
    </NavigationNamesBoundary>
  );
}
