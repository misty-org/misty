import type { DesktopNavItem } from "@/application/layouts/model/types";
import { openAccountSettingsInBrowser } from "@/features/account";
import { ActivityBridge } from "@/features/activity";
import type { AppTab } from "@/features/app-shell";
import { useAppStore } from "@/features/app-shell";
import { useAuth } from "@/features/auth";
import { BrowserRuntimeBridge, setBrowserWebviewsSuspended } from "@/features/browser";
import { MediaSearchViewer } from "@/features/files/explorer";
import { GlobalMisty } from "@/features/global-search";
import { settingsBoolean, useSettingsStore } from "@/features/settings";
import { SpacesRealtimeBridge } from "@/features/spaces";
import { useWorkspaceStore, workspaceSurfaceFromRoute } from "@/features/workspace";
import { ArrowLeft, ArrowRight, Minus, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useNavigationType } from "react-router-dom";
import { FramePacingOverlay } from "./FramePacingOverlay";
import { ProfilePopover } from "./ProfilePopover";
import { GlobalNavigator } from "./GlobalNavigator";
import { WorkspaceCanvas } from "./WorkspaceCanvas";
import { NavigatorModeMenu } from "./NavigatorModeMenu";
import {
  readNavigatorMode,
  type NavigatorMode,
  type VisibleNavigatorMode,
  writeNavigatorMode,
} from "./navigatorMode";
import { AppNoticePublisher, RouteNotice } from "./RouteNotices";
import { RemotesOverlay, SettingsOverlay } from "./SettingsOverlays";
import { TransferCompletionNotifier, WorkStatusPopup } from "./TransferStatus";
import { settingsFallbackRoute } from "./helpers";
import {
  desktopFrameClass,
  desktopNavbarClass,
  desktopRouteShellClass,
  desktopTitlebarClass,
  desktopTitlebarDoubleClickLayerClass,
  desktopTitlebarNavigationButtonClass,
  desktopTitlebarNavigationClass,
  desktopTitlebarTitleClass,
  tabletFrameClass,
  tabletNavbarClass,
  tabletRouteShellClass,
  windowsTitlebarCloseButtonClass,
  windowsTitlebarControlButtonClass,
  windowsTitlebarControlsClass,
  windowsTitlebarTitleClass,
} from "./styles";
import { useDesktopBootstrap } from "./useDesktopBootstrap";
import { useDesktopFrameStyle } from "./useDesktopFrameStyle";
import { useDesktopWindowChrome } from "./useDesktopWindowChrome";
import { useDesktopNavigationHistory } from "./useDesktopNavigationHistory";
export type {
  AppNoticeEntry,
  AppNoticeKind,
  AppNoticeSource,
  DesktopNavItem,
  DesktopPlatform,
  FramePacingState,
  WindowBounds,
  WindowRect,
} from "@/application/layouts/model/types";

// Windows "restore" caption glyph: two offset squares, the front one masked with
// the titlebar background so the overlap reads cleanly.
function RestoreGlyph() {
  return (
    <span className="relative block size-3" aria-hidden="true">
      <span className="absolute right-0 top-0 size-2 rounded-[1px] border border-current" />
      <span className="absolute bottom-0 left-0 size-2 rounded-[1px] border border-current bg-charcoal-workspace" />
    </span>
  );
}

export function DesktopLayout(props: {
  getRouteId: (pathname: string) => AppTab;
  navItems: DesktopNavItem[];
}) {
  const { user, refreshUser } = useAuth();
  const {
    location,
    navigate,
    app,
    settingsLoad,
    activePaneId,
    activePanePath,
    lastAppRoute,
    lastNonSettingsRouteRef,
    routeId,
  } = useDesktopBootstrap({ getRouteId: props.getRouteId });
  const {
    usesNativeWindowChrome,
    shouldShowWindowsTitlebarControls,
    isWindowMaximized,
    startTitlebarDrag,
    handleDesktopTitlebarPointerDown,
    togglePseudoMaximize,
    minimizeTitlebarWindow,
    closeTitlebarWindow,
  } = useDesktopWindowChrome();
  const { app: frameApp, mistyLogoSource } = useDesktopFrameStyle();
  const selfHosted = app?.environment.serverMode === "self_hosted";
  const navigationType = useNavigationType();

  const framePacingOverlayEnabled = useSettingsStore((state) =>
    settingsBoolean(
      state.settings?.document ?? {},
      "advanced",
      "frame_pacing_overlay_enabled",
      false,
    ),
  );

  const profileAnchorRef = useRef<HTMLButtonElement | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [navigatorMode, setNavigatorModeState] = useState<NavigatorMode>(readNavigatorMode);
  const lastVisibleNavigatorMode = useRef<VisibleNavigatorMode>(
    navigatorMode === "hidden" ? "full" : navigatorMode,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [remotesOpen, setRemotesOpen] = useState(false);
  const navigationHistory = useDesktopNavigationHistory({ location, navigate, navigationType });
  const openWorkspaceSurface = useWorkspaceStore((state) => state.openSurface);
  const setNavigatorMode = useCallback((mode: NavigatorMode) => {
    if (mode !== "hidden") lastVisibleNavigatorMode.current = mode;
    setBrowserWebviewsSuspended(true, "navigator-layout");
    setNavigatorModeState(mode);
    writeNavigatorMode(mode);
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => setBrowserWebviewsSuspended(false, "navigator-layout")),
    );
  }, []);
  const refreshUserAfterSettings = useCallback(() => {
    void refreshUser().catch(() => undefined);
  }, [refreshUser]);
  const openSettingsOverlay = useCallback(() => {
    setSettingsOpen(true);
    void settingsLoad();
  }, [settingsLoad]);
  const closeSettingsOverlay = useCallback(() => {
    setSettingsOpen(false);
    refreshUserAfterSettings();
  }, [refreshUserAfterSettings]);
  // Account management lives on the website. Opening it hands the current
  // session off to the browser rather than rendering anything locally.
  const openAccountSettings = useCallback(() => {
    setSettingsOpen(false);
    void openAccountSettingsInBrowser().catch((error: unknown) => {
      // The hand-off needs the network, so an offline click has to say so
      // rather than silently opening nothing.
      useAppStore
        .getState()
        .setError(
          error instanceof Error
            ? error.message
            : "Could not open account settings. Check your connection and try again.",
        );
    });
  }, []);
  const openRemotesOverlay = useCallback(() => {
    setSettingsOpen(false);
    setRemotesOpen(true);
  }, []);
  const closeRemotesOverlay = useCallback(() => {
    setRemotesOpen(false);
  }, []);
  useEffect(() => {
    if (!location.pathname.startsWith("/settings")) return;
    openSettingsOverlay();
    navigate(settingsFallbackRoute(lastNonSettingsRouteRef.current, lastAppRoute), {
      replace: true,
    });
  }, [lastAppRoute, lastNonSettingsRouteRef, location.pathname, navigate, openSettingsOverlay]);

  useEffect(() => {
    if (!location.pathname.startsWith("/providers")) return;
    openRemotesOverlay();
    navigate(settingsFallbackRoute(lastNonSettingsRouteRef.current, lastAppRoute), {
      replace: true,
    });
  }, [lastAppRoute, lastNonSettingsRouteRef, location.pathname, navigate, openRemotesOverlay]);

  useEffect(() => {
    const surface = workspaceSurfaceFromRoute(location.pathname);
    if (surface) openWorkspaceSurface(surface);
  }, [location.pathname, openWorkspaceSurface]);

  useEffect(() => {
    if (location.pathname === "/") navigate("/home", { replace: true });
  }, [location.pathname, navigate]);

  useEffect(() => {
    const handleWorkspaceKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape" && useWorkspaceStore.getState().layout.maximizedPaneId) {
        event.preventDefault();
        useWorkspaceStore.getState().restoreLayout();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === "Enter") {
        event.preventDefault();
        useWorkspaceStore.getState().toggleMaximize();
      }
    };
    window.addEventListener("keydown", handleWorkspaceKeys);
    return () => window.removeEventListener("keydown", handleWorkspaceKeys);
  }, []);

  useEffect(() => {
    const toggleNavigator = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) return;
      if (event.key.toLocaleLowerCase() !== "b") return;
      event.preventDefault();
      event.stopPropagation();
      setNavigatorMode(navigatorMode === "hidden" ? lastVisibleNavigatorMode.current : "hidden");
    };
    window.addEventListener("keydown", toggleNavigator, true);
    return () => window.removeEventListener("keydown", toggleNavigator, true);
  }, [navigatorMode, setNavigatorMode]);

  useEffect(() => {
    setBrowserWebviewsSuspended(profileOpen || settingsOpen || remotesOpen, "shell-overlay");
    return () => setBrowserWebviewsSuspended(false, "shell-overlay");
  }, [profileOpen, remotesOpen, settingsOpen]);

  useEffect(() => {
    const handleNavigationKeys = (event: KeyboardEvent) => {
      const bracketBack = event.metaKey && !event.altKey && event.key === "[";
      const bracketForward = event.metaKey && !event.altKey && event.key === "]";
      const arrowBack = event.altKey && !event.metaKey && event.key === "ArrowLeft";
      const arrowForward = event.altKey && !event.metaKey && event.key === "ArrowRight";
      if (bracketBack || arrowBack) {
        if (!navigationHistory.canGoBack) return;
        event.preventDefault();
        navigationHistory.goBack();
      } else if (bracketForward || arrowForward) {
        if (!navigationHistory.canGoForward) return;
        event.preventDefault();
        navigationHistory.goForward();
      }
    };
    window.addEventListener("keydown", handleNavigationKeys);
    return () => window.removeEventListener("keydown", handleNavigationKeys);
  }, [navigationHistory]);

  const shouldShowWindowsControls = shouldShowWindowsTitlebarControls;
  const frameClass = usesNativeWindowChrome ? desktopFrameClass : tabletFrameClass;
  const navbarClass = usesNativeWindowChrome ? desktopNavbarClass : tabletNavbarClass;
  const routeShellClass = usesNativeWindowChrome ? desktopRouteShellClass : tabletRouteShellClass;
  return (
    <main
      className={`${frameClass} ${navigatorGridClass(navigatorMode)}`}
      data-misty-desktop-frame
      onPointerDown={(event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target?.closest("[data-misty-window-titlebar-region='true']")) return;
        handleDesktopTitlebarPointerDown(event);
      }}
    >
      {usesNativeWindowChrome ? (
        <header className={desktopTitlebarClass} onPointerDown={handleDesktopTitlebarPointerDown}>
          {/* Blank titlebar areas use native drag. A second press invokes native
              macOS zoom/restore; borderless Windows/Linux use pseudo-maximize. */}
          <div className={desktopTitlebarDoubleClickLayerClass} />
          <span
            className={
              shouldShowWindowsControls ? windowsTitlebarTitleClass : desktopTitlebarTitleClass
            }
          >
            {selfHosted ? "Misty — Self-hosted" : "Misty"}
          </span>
          {!shouldShowWindowsControls ? (
            <div className={desktopTitlebarNavigationClass} data-misty-window-drag-block="true">
              <NavigatorModeMenu mode={navigatorMode} onModeChange={setNavigatorMode} />
              <button
                type="button"
                className={desktopTitlebarNavigationButtonClass}
                aria-label="Go back"
                title="Back (⌘[)"
                disabled={!navigationHistory.canGoBack}
                onClick={navigationHistory.goBack}
              >
                <ArrowLeft size={17} />
              </button>
              <button
                type="button"
                className={desktopTitlebarNavigationButtonClass}
                aria-label="Go forward"
                title="Forward (⌘])"
                disabled={!navigationHistory.canGoForward}
                onClick={navigationHistory.goForward}
              >
                <ArrowRight size={17} />
              </button>
            </div>
          ) : (
            <div className="absolute left-2 top-0 z-[4] flex h-full items-center">
              <NavigatorModeMenu mode={navigatorMode} onModeChange={setNavigatorMode} />
            </div>
          )}
          {shouldShowWindowsControls ? (
            <div className={windowsTitlebarControlsClass}>
              <button
                type="button"
                className={windowsTitlebarControlButtonClass}
                aria-label="Minimize window"
                title="Minimize"
                onClick={minimizeTitlebarWindow}
              >
                <Minus size={16} strokeWidth={1.6} />
              </button>
              <button
                type="button"
                className={windowsTitlebarControlButtonClass}
                aria-label={isWindowMaximized ? "Restore window" : "Maximize window"}
                title={isWindowMaximized ? "Restore" : "Maximize"}
                onClick={() => void togglePseudoMaximize().catch(() => undefined)}
              >
                {isWindowMaximized ? <RestoreGlyph /> : <Square size={12} strokeWidth={1.6} />}
              </button>
              <button
                type="button"
                className={windowsTitlebarCloseButtonClass}
                aria-label="Close window"
                title="Close"
                onClick={closeTitlebarWindow}
              >
                <X size={17} strokeWidth={1.6} />
              </button>
            </div>
          ) : null}
        </header>
      ) : null}

      {!usesNativeWindowChrome ? (
        <div className="absolute left-2 top-1 z-[60]" data-misty-window-drag-block="true">
          <NavigatorModeMenu mode={navigatorMode} onModeChange={setNavigatorMode} />
        </div>
      ) : null}

      {navigatorMode !== "hidden" ? (
        <div className={navbarClass}>
          <GlobalNavigator
            collapsed={navigatorMode === "icons"}
            mistyLogoSource={mistyLogoSource}
            profileAnchorRef={profileAnchorRef}
            profileOpen={profileOpen}
            settingsOpen={settingsOpen || location.pathname.startsWith("/settings")}
            onProfileClick={() => setProfileOpen((open) => !open)}
            onSettingsClick={openSettingsOverlay}
            onStartWindowDrag={usesNativeWindowChrome ? startTitlebarDrag : undefined}
          />
        </div>
      ) : null}

      <section className={`${routeShellClass} route-shell`} data-misty-route-shell>
        <AppNoticePublisher />
        <RouteNotice routeId={routeId} />

        {location.pathname === "/home" ? <Outlet /> : <WorkspaceCanvas outlet={<Outlet />} />}
      </section>

      <WorkStatusPopup />
      <TransferCompletionNotifier />
      <FramePacingOverlay enabled={framePacingOverlayEnabled} />
      <ProfilePopover
        anchorRef={profileAnchorRef}
        currentPath={location.pathname}
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        onOpenAccountSettings={openAccountSettings}
      />
      <RemotesOverlay open={remotesOpen} onClose={closeRemotesOverlay} />
      <SettingsOverlay open={settingsOpen} onClose={closeSettingsOverlay} />
      {user?.id ? (
        <GlobalMisty
          accountId={user.id}
          currentPath={`${location.pathname}${location.search}`}
          activePaneId={activePaneId}
          activePanePath={
            activePanePath || frameApp?.environment.homeDir || app?.environment.homeDir || ""
          }
        />
      ) : null}
      <BrowserRuntimeBridge />
      <MediaSearchViewer />
      <SpacesRealtimeBridge />
      <ActivityBridge />
    </main>
  );
}

function navigatorGridClass(mode: NavigatorMode): string {
  if (mode === "hidden") return "grid-cols-[0px_minmax(0,1fr)]";
  if (mode === "icons") return "grid-cols-[72px_minmax(0,1fr)]";
  return "grid-cols-[232px_minmax(0,1fr)]";
}
