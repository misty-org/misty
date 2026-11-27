import { type AppTab } from "@/app/shell";
import {
  AccountClosingNotice,
  AccountSuspendedNotice,
  ServerAlertsNotice,
  openSignInSheet,
  SignInSheet,
  useAuth,
} from "@/features/account";
import { blockIfUnsaved } from "@/features/settings";
import { setBrowserWebviewsSuspended } from "@/features/app-windows";
import { useWindowDockingLayout } from "@/features/app-windows";
import { appZoomRenderScale, useAppZoomValue } from "@/shared/hooks/use_app_zoom";
import { cn, placeChrome, Surface } from "@misty/ui";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Outlet } from "react-router-dom";
import { isTopEdgeDragPress } from "./window_chrome_drag";
import { useDockingTransition } from "./use_docking_transition";
import { DeferUntilIdle } from "./DeferUntilIdle";
import { FramePacingOverlay } from "./FramePacingOverlay";
import { AccountIsland } from "./AccountIsland";
import { AppNoticePublisher } from "./RouteNotices";
import { StandaloneRouteSurface } from "./StandaloneRouteSurface";
import * as styles from "./styles";
import { useDesktopBootstrap } from "./use_desktop_bootstrap";
import { useDesktopFrameStyle } from "./use_desktop_frame_style";
import { useDesktopRouteEffects } from "./use_desktop_route_effects";
import { useDesktopShellStatus } from "./use_desktop_shell_status";
import { useDesktopShortcuts } from "./use_desktop_shortcuts";
import { useDesktopTitlebarGeometry } from "./use_desktop_titlebar_geometry";
import { useDesktopWindowChrome } from "./use_desktop_window_chrome";
import {
  useOtherWindowsHiddenWhileAddingAccount,
  useSignedOutWindow,
} from "./use_signed_out_window";
import { useStrayBrowserPages } from "./use_stray_browser_pages";
import { useSettingsOverlay } from "./use_settings_overlay";
import { WindowsTitlebarControls } from "./WindowsTitlebarControls";
import { useCaptionSlot } from "./use_caption_slot";
import { WorkspaceCanvas } from "./WorkspaceCanvas";
import { useSidebarPlaceColor } from "./sidebar_place_color";
import { withWindowChrome } from "./docking_geometry";

const CursorCompanionController = lazy(() =>
  import("@/features/agents/tutor/cursor/CursorCompanionController").then((module) => ({
    default: module.CursorCompanionController,
  })),
);
const TutorTraySync = lazy(() =>
  import("@/features/agents/tutor/cursor/tutor_tray").then((module) => ({
    default: module.TutorTraySync,
  })),
);
const DictationController = lazy(() =>
  import("@/features/voice/DictationController").then((module) => ({
    default: module.DictationController,
  })),
);
const CapturePanel = lazy(() =>
  import("@/features/voice/capture/CapturePanel").then((module) => ({
    default: module.CapturePanel,
  })),
);
const CallDock = lazy(() =>
  import("@/features/direct/calls/CallDock").then((module) => ({ default: module.CallDock })),
);
const DirectRoot = lazy(() =>
  import("@/features/direct/DirectRoot").then((module) => ({ default: module.DirectRoot })),
);
const SignOutSheet = lazy(() =>
  import("@/features/account/sign-in-sheet/SignOutSheet").then((module) => ({
    default: module.SignOutSheet,
  })),
);
const DeviceApprovalDialog = lazy(() =>
  import("@/features/account/devices/DeviceApprovalDialog").then((module) => ({
    default: module.DeviceApprovalDialog,
  })),
);
const TourHost = lazy(() =>
  import("@/features/onboarding/tours/TourHost").then((module) => ({ default: module.TourHost })),
);
const HelpDialog = lazy(() =>
  import("./HelpDialog").then((module) => ({ default: module.HelpDialog })),
);
const DesktopShellOverlays = lazy(() =>
  import("./DesktopShellOverlays").then((module) => ({ default: module.DesktopShellOverlays })),
);
export function DesktopLayout(props: { getRouteId: (pathname: string) => AppTab }) {
  useStrayBrowserPages();
  const { user, refreshUser, sessionExpired } = useAuth();
  const { location, navigate, lastAppRoute, lastNonSettingsRouteRef } = useDesktopBootstrap({
    getRouteId: props.getRouteId,
  });
  const {
    desktopPlatform,
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

  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const docking = useWindowDockingLayout();
  const {
    settingsOpen,
    setSettingsOpen,
    openSettingsOverlay,
    closeSettingsOverlay,
    openAccountSettings,
  } = useSettingsOverlay({ refreshUser });
  useDesktopRouteEffects({
    location,
    navigate,
    lastAppRoute,
    lastNonSettingsRouteRef,
    openSettingsOverlay,
  });
  useDesktopShortcuts({ openSettingsOverlay, signedIn: Boolean(user) });

  useEffect(() => {
    setBrowserWebviewsSuspended(accountMenuOpen || settingsOpen, "shell-overlay");
    return () => setBrowserWebviewsSuspended(false, "shell-overlay");
  }, [accountMenuOpen, settingsOpen]);

  useEffect(() => setAccountMenuOpen(false), [docking]);
  const shellRef = useRef<HTMLElement>(null);
  useDockingTransition(shellRef, `${docking.navigation}:${docking.tabs}`);

  const shouldShowWindowsControls = shouldShowWindowsTitlebarControls;
  const captionSlot = useCaptionSlot(shellRef, shouldShowWindowsControls);
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
    shouldShowWindowsControls,
    captionInline: Boolean(captionSlot),
    appZoom,
  });
  useSignedOutWindow(isAuthRoute);
  const placeColor = useSidebarPlaceColor();
  useOtherWindowsHiddenWhileAddingAccount(
    isAuthRoute && Boolean((location.state as { addingAccount?: boolean } | null)?.addingAccount),
  );
  const stripAccount = !isAuthRoute ? (
    <>
      <Suspense fallback={null}>
        <CallDock />
      </Suspense>
      <AccountIsland
        open={accountMenuOpen}
        onOpenChange={(open) => {
          if (open) {
            if (blockIfUnsaved()) return;
            setSettingsOpen(false);
          }
          setAccountMenuOpen(open);
        }}
        onOpenAccountSettings={openAccountSettings}
        settingsOpen={settingsOpen || location.pathname.startsWith("/settings")}
        onSettingsClick={openSettingsOverlay}
        sessionExpired={sessionExpired}
        onSignIn={(again) =>
          again ? openSignInSheet("expired", user?.email) : openSignInSheet("account")
        }
      />
    </>
  ) : null;
  return (
    <Surface
      as="main"
      tone="chrome"
      ref={shellRef}
      className={cn(
        "misty-docking-frame",
        "relative isolate grid h-full min-h-0 overflow-hidden",
        "animate-[misty-fade-in_220ms_cubic-bezier(0.22,0.61,0.36,1)_both] motion-reduce:animate-none",
        "transition-[grid-template-columns,grid-template-rows]",
        styles.navigatorMotionClass,
        "has-[[data-panel-resize-handle-id]]:![--misty-window-chrome:var(--misty-theme-workspace)]",
      )}
      style={
        isAuthRoute
          ? {
              gridTemplateColumns: "minmax(0, 1fr)",
              gridTemplateRows: "calc(var(--spacing) * 9.5) minmax(0, 1fr)",
            }
          : withWindowChrome(geometry.frame, placeChrome(placeColor))
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
        if (shellRef.current?.contains(target) && isTopEdgeDragPress(event))
          handleTopEdgePointerDown(event);
      }}
    >
      <header
        className={cn(
          "absolute inset-x-0 top-0 z-[var(--stack-pane-top)] h-[var(--shell-titlebar,calc(var(--spacing)*9.5))]",
          isAuthRoute ? "pointer-events-auto border-b-0 bg-transparent" : "pointer-events-none",
        )}
        data-shared-chrome={!isAuthRoute}
        onPointerDown={handleDesktopTitlebarPointerDown}
      >
        {shouldShowWindowsControls ? (
          <WindowsTitlebarControls
            systemGlyphs={desktopPlatform === "windows"}
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

      <Surface
        as="section"
        tone={isAuthRoute ? "none" : "page"}
        className={cn(
          "route-shell relative z-10 min-h-0 min-w-0 overflow-hidden",
          isAuthRoute && "bg-window-chrome",
        )}
        style={isAuthRoute ? { gridColumn: 1, gridRow: 2 } : geometry.content}
        data-misty-route-shell
      >
        {!isAuthRoute ? <AppNoticePublisher /> : null}

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
              stripAccount={stripAccount}
            />
          )}
          {!isAuthRoute && user?.id ? (
            <DeferUntilIdle>
              <Suspense fallback={null}>
                <CursorCompanionController key={user.id} accountId={user.id} />
                <TutorTraySync />
                <DictationController key={`dictation-${user.id}`} />
                <CapturePanel key={`capture-${user.id}`} />
              </Suspense>
            </DeferUntilIdle>
          ) : null}
        </>
      </Surface>

      <FramePacingOverlay enabled={!isAuthRoute && framePacingOverlayEnabled} />
      <SignInSheet />
      <AccountSuspendedNotice />
      <AccountClosingNotice />
      {!isAuthRoute && user ? <ServerAlertsNotice /> : null}
      <Suspense fallback={null}>
        {!isAuthRoute && user ? <SignOutSheet /> : null}
        {!isAuthRoute && user ? <DeviceApprovalDialog /> : null}
        {!isAuthRoute ? <DirectRoot key={user?.id ?? "signed-out"} accountId={user?.id} /> : null}
        {!isAuthRoute ? <HelpDialog /> : null}
        {!isAuthRoute ? <TourHost /> : null}
        {!isAuthRoute ? (
          <DesktopShellOverlays
            settingsOpen={settingsOpen}
            onCloseSettings={closeSettingsOverlay}
            userId={user?.id}
          />
        ) : null}
      </Suspense>
    </Surface>
  );
}
