import { CursorCompanionController, TutorTraySync } from "@/features/agents";
import { CapturePanel, DictationController } from "@/features/voice";
import { type AppTab } from "@/app/shell";
import {
  AccountClosingNotice,
  AccountSuspendedNotice,
  ServerAlertsNotice,
  openSignInSheet,
  SignInSheet,
  SignOutSheet,
  useAuth,
} from "@/features/account";
import { blockIfUnsaved } from "@/features/settings";
import { setBrowserWebviewsSuspended } from "@/features/app-windows";
import { useWindowDockingLayout } from "@/features/app-windows";
import { appZoomRenderScale, useAppZoomValue } from "@/shared/hooks/useAppZoom";
import { cn } from "@/shared/ui";
import { useEffect, useRef, useState } from "react";
import { Outlet } from "react-router-dom";
import "./docking.css";
import { isTopEdgeDragPress } from "./windowChromeDrag";
import { useDockingTransition } from "./useDockingTransition";
import { DeferUntilIdle } from "./DeferUntilIdle";
import { DesktopShellOverlays } from "./DesktopShellOverlays";
import { FramePacingOverlay } from "./FramePacingOverlay";
import { AccountIsland } from "./AccountIsland";
import { AppNoticePublisher } from "./RouteNotices";
import { StandaloneRouteSurface } from "./StandaloneRouteSurface";
import * as styles from "./styles";
import { useDesktopBootstrap } from "./useDesktopBootstrap";
import { useDesktopFrameStyle } from "./useDesktopFrameStyle";
import { useDesktopRouteEffects } from "./useDesktopRouteEffects";
import { useDesktopShellStatus } from "./useDesktopShellStatus";
import { HelpDialog } from "./HelpDialog";
import { TourHost } from "@/features/onboarding";
import { useDesktopShortcuts } from "./useDesktopShortcuts";
import { useDesktopTitlebarGeometry } from "./useDesktopTitlebarGeometry";
import { useDesktopWindowChrome } from "./useDesktopWindowChrome";
import { useOtherWindowsHiddenWhileAddingAccount, useSignedOutWindow } from "./useSignedOutWindow";
import { useSignedOutHotkeys } from "./useSignedOutHotkeys";
import { useStrayBrowserPages } from "./useStrayBrowserPages";
import { useFocusModeShortcuts } from "./useFocusModeShortcuts";
import { useSettingsOverlay } from "./useSettingsOverlay";
import { WindowsTitlebarControls } from "./WindowsTitlebarControls";
import { useCaptionSlot } from "./useCaptionSlot";
import { useSidebarCollapsedStore } from "@/app/shell/sidebarCollapsed";
import { WorkspaceCanvas } from "./WorkspaceCanvas";
export function DesktopLayout(props: { getRouteId: (pathname: string) => AppTab }) {
  useStrayBrowserPages();
  const { user, refreshUser, transitioning, sessionExpired } = useAuth();
  const { location, navigate, lastAppRoute, lastNonSettingsRouteRef } = useDesktopBootstrap({
    getRouteId: props.getRouteId,
  });
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

  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const docking = useWindowDockingLayout();
  const focusMode = useFocusModeShortcuts();
  const {
    settingsOpen,
    setSettingsOpen,
    openSettingsOverlay,
    closeSettingsOverlay,
    openAccountSettings,
  } = useSettingsOverlay({ refreshUser });
  useDesktopRouteEffects({
    userId: user?.id,
    transitioning,
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
  useSignedOutHotkeys(!user && !isAuthRoute);
  // Over the window's corner only where no sidebar can hold them: sign-in, or a page that
  // shows no sidebar. A collapsed sidebar takes them away with it.
  const floatingCaption = isAuthRoute || !sidebarCollapsed;
  useOtherWindowsHiddenWhileAddingAccount(
    isAuthRoute && Boolean((location.state as { addingAccount?: boolean } | null)?.addingAccount),
  );
  const stripAccount = !isAuthRoute ? (
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
      signedOut={!user}
      sessionExpired={sessionExpired}
      onSignIn={(again) =>
        again ? openSignInSheet("expired", user?.email) : openSignInSheet("account")
      }
    />
  ) : null;
  return (
    <main
      ref={shellRef}
      className={cn(
        "misty-docking-frame",
        "misty-app-reveal",
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
            standard={isAuthRoute}
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
              stripAccount={stripAccount}
            />
          )}
          {!isAuthRoute && user?.id ? (
            <DeferUntilIdle>
              <CursorCompanionController key={user.id} accountId={user.id} />
              <TutorTraySync />
              <DictationController key={`dictation-${user.id}`} />
              <CapturePanel key={`capture-${user.id}`} />
            </DeferUntilIdle>
          ) : null}
        </>
      </section>

      <FramePacingOverlay enabled={!isAuthRoute && framePacingOverlayEnabled} />
      {/* Also the setup wizard, which the first-run welcome opens. */}
      <SignInSheet />
      {!isAuthRoute && user ? <SignOutSheet /> : null}
      <AccountSuspendedNotice />
      <AccountClosingNotice />
      {!isAuthRoute && user ? <ServerAlertsNotice /> : null}
      {!isAuthRoute ? <HelpDialog /> : null}
      {!isAuthRoute ? <TourHost /> : null}
      {!isAuthRoute ? (
        <DesktopShellOverlays
          settingsOpen={settingsOpen}
          onCloseSettings={closeSettingsOverlay}
          userId={user?.id}
        />
      ) : null}
    </main>
  );
}
