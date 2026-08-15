import type { DesktopNavItem } from "@/application/layouts/model/types";
import { openAccountSettingsInBrowser } from "@/features/account";
import { ActivityBridge, unreadActivityCountForTool, useActivityStore } from "@/features/activity";
import type { AppTab } from "@/features/app-shell";
import { useAppStore } from "@/features/app-shell";
import { useAuth } from "@/features/auth";
import { MediaSearchViewer } from "@/features/files/explorer";
import { GlobalMisty } from "@/features/global-search";
import { settingsBoolean, useSettingsStore } from "@/features/settings";
import { SpaceNavRail, SpacesRealtimeBridge } from "@/features/spaces";
import { hideRuntimeAssetOnError, revealRuntimeAssetOnLoad } from "@/shared/platform/runtimeAsset";
import { Minus, Server, Square, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet } from "react-router-dom";
import { FramePacingOverlay } from "./FramePacingOverlay";
import { NavGroup, ProfileNavButton, SettingsNavButton } from "./NavRail";
import { ProfilePopover } from "./ProfilePopover";
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
  desktopTitlebarTitleClass,
  navbarBottomClass,
  navbarGroupClass,
  navbarSpacesClass,
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
    handleWindowsTitlebarPointerDown,
    expandTitlebarWindow,
    togglePseudoMaximize,
    minimizeTitlebarWindow,
    closeTitlebarWindow,
  } = useDesktopWindowChrome();
  const { app: frameApp, mistyLogoSource } = useDesktopFrameStyle();
  const selfHosted = app?.environment.serverMode === "self_hosted";
  const selfHostedHost = (() => {
    try {
      return app?.environment.serverUrl ? new URL(app.environment.serverUrl).host : "Self-hosted";
    } catch {
      return "Self-hosted";
    }
  })();
  const selfHostedName = app?.environment.serverName?.trim() || "Misty server";

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [remotesOpen, setRemotesOpen] = useState(false);
  const navItems = props.navItems;
  const activityItems = useActivityStore((state) => state.allItems);
  const navBadges = useMemo(
    () => ({
      files: unreadActivityCountForTool(activityItems, "files"),
      agents: unreadActivityCountForTool(activityItems, "agents"),
      extensions: unreadActivityCountForTool(activityItems, "extensions"),
    }),
    [activityItems],
  );
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

  const shouldShowWindowsControls = shouldShowWindowsTitlebarControls;
  const frameClass = usesNativeWindowChrome ? desktopFrameClass : tabletFrameClass;
  const navbarClass = usesNativeWindowChrome ? desktopNavbarClass : tabletNavbarClass;
  const routeShellClass = usesNativeWindowChrome ? desktopRouteShellClass : tabletRouteShellClass;

  return (
    <main className={frameClass}>
      {usesNativeWindowChrome ? (
        <header
          className={desktopTitlebarClass}
          data-tauri-drag-region={shouldShowWindowsControls ? undefined : ""}
          onPointerDown={
            shouldShowWindowsControls ? handleWindowsTitlebarPointerDown : startTitlebarDrag
          }
        >
          {/* Windows/Linux handle drag + double-press-to-maximize via the pointer
              handler above; macOS keeps the native drag region + pseudo-maximize. */}
          <div
            className={desktopTitlebarDoubleClickLayerClass}
            onDoubleClick={shouldShowWindowsControls ? undefined : expandTitlebarWindow}
          />
          <span
            className={
              shouldShowWindowsControls ? windowsTitlebarTitleClass : desktopTitlebarTitleClass
            }
          >
            {selfHosted ? "Misty — Self-hosted" : "Misty"}
          </span>
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

      <nav
        className={navbarClass}
        aria-label="Primary"
        onPointerDown={usesNativeWindowChrome ? startTitlebarDrag : undefined}
      >
        <div
          className="relative flex h-14 w-[54px] shrink-0 items-start justify-center pt-3"
          title={
            selfHosted
              ? `Self-hosted · ${selfHostedName} (${selfHostedHost})`
              : "Misty Hosted"
          }
        >
          {mistyLogoSource ? (
            <img
              className="h-[34px] w-[34px] object-contain"
              src={mistyLogoSource}
              onError={hideRuntimeAssetOnError}
              onLoad={revealRuntimeAssetOnLoad}
              alt="Misty"
            />
          ) : null}
          {selfHosted ? (
            <span className="absolute bottom-0 right-0 grid size-5 place-items-center rounded-full border border-charcoal-border bg-charcoal-card text-sage-fg">
              <Server size={11} strokeWidth={2} aria-label="Self-hosted" />
            </span>
          ) : null}
        </div>
        <span className="mb-0.5 h-px w-7 shrink-0 bg-charcoal-border" aria-hidden="true" />
        <div className={navbarGroupClass}>
          {navItems.length ? (
            <NavGroup
              currentPath={location.pathname}
              items={navItems}
              badges={navBadges}
              iconOnly
            />
          ) : null}
        </div>
        <span className="my-0.5 h-px w-7 shrink-0 bg-charcoal-border" aria-hidden="true" />
        <div className={navbarSpacesClass}>
          <SpaceNavRail />
        </div>
        <div className={navbarBottomClass}>
          <span className="mb-0.5 h-px w-7 shrink-0 bg-charcoal-border" aria-hidden="true" />
          <SettingsNavButton
            open={settingsOpen || location.pathname.startsWith("/settings")}
            onClick={openSettingsOverlay}
          />
          <ProfileNavButton
            ref={profileAnchorRef}
            open={profileOpen}
            onClick={() => setProfileOpen((open) => !open)}
          />
        </div>
      </nav>

      <section className={`${routeShellClass} route-shell`}>
        <AppNoticePublisher />
        <RouteNotice routeId={routeId} />

        <Outlet />
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
      <MediaSearchViewer />
      <SpacesRealtimeBridge />
      <ActivityBridge />
    </main>
  );
}
