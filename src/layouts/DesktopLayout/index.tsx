import type {
  DesktopNavItem,
  WindowBounds,
  WindowRect,
  DesktopPlatform,
  AppNoticeSource,
  AppNoticeKind,
  AppNoticeEntry,
  FramePacingState,
} from "@/models/types/layouts";
export type {
  DesktopNavItem,
  WindowBounds,
  WindowRect,
  DesktopPlatform,
  AppNoticeSource,
  AppNoticeKind,
  AppNoticeEntry,
  FramePacingState,
} from "@/models/types/layouts";
import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { Minus, Square, X } from "lucide-react";
import { hideRuntimeAssetOnError, revealRuntimeAssetOnLoad } from "@/platform/runtimeAsset";
import type { AppTab } from "@/models/types/routing/types";
import {
  selectNotificationPreferences,
  settingsBoolean,
  useAppStore,
  useSettingsStore,
} from "@/stores/app";
import { openAccountSettingsInBrowser } from "@/features/account/openAccountSettings";
import { useExplorerStore } from "@/stores/explorer";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import { DeepSearchOverlay } from "@/features/explorer/components/DeepSearchOverlay";
import { MediaSearchViewer } from "@/features/explorer/components/MediaSearchViewer";
import { SpacesRealtimeBridge } from "@/features/spaces/SpacesRealtimeBridge";
import { SpaceNavRail } from "@/features/spaces/components/SpaceNavRail";
import {
  desktopNavbarClass,
  desktopFrameClass,
  desktopRouteShellClass,
  desktopTitlebarClass,
  desktopTitlebarDoubleClickLayerClass,
  desktopTitlebarTitleClass,
  navbarBottomClass,
  navbarGroupClass,
  tabletFrameClass,
  tabletNavbarClass,
  tabletRouteShellClass,
  windowsTitlebarCloseButtonClass,
  windowsTitlebarControlButtonClass,
  windowsTitlebarControlsClass,
  windowsTitlebarTitleClass,
} from "./styles";
import { settingsFallbackRoute } from "./helpers";
import { useDesktopWindowChrome } from "./useDesktopWindowChrome";
import { useDesktopFrameStyle } from "./useDesktopFrameStyle";
import { useDesktopBootstrap } from "./useDesktopBootstrap";
import { useUnreadBadgeSync } from "./useUnreadBadgeSync";
import { ActivityNavButton, NavGroup, ProfileNavButton, SettingsNavButton } from "./NavRail";
import { ProfilePopover } from "./ProfilePopover";
import { AppNoticePublisher, RouteNotice } from "./RouteNotices";
import { TransferCompletionNotifier, WorkStatusPopup } from "./TransferStatus";
import { ActivityOverlay, RemotesOverlay, SettingsOverlay } from "./SettingsOverlays";
import { FramePacingOverlay } from "./FramePacingOverlay";
import { useAuth } from "@/features/auth/AuthContext";

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
  const { refreshUser } = useAuth();
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
    desktopPlatform,
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

  const localUnreadActivityCount = useExplorerStore(
    (state) => state.notificationHistory.filter((notification) => !notification.read).length,
  );
  const cloudUnreadActivityCount = useSpacesStore(
    (state) =>
      [...state.inbox.unreads, ...state.inbox.mentions].filter((item) => !item.seen_at).length,
  );
  const unreadActivityCount = localUnreadActivityCount + cloudUnreadActivityCount;
  const notificationPreferences = useSettingsStore(
    useShallow((state) => selectNotificationPreferences(state.settings?.document)),
  );
  const framePacingOverlayEnabled = useSettingsStore((state) =>
    settingsBoolean(
      state.settings?.document ?? {},
      "advanced",
      "frame_pacing_overlay_enabled",
      false,
    ),
  );
  useUnreadBadgeSync({
    badgeCountEnabled: notificationPreferences.badgeCountEnabled,
    unreadActivityCount,
  });

  const activityAnchorRef = useRef<HTMLButtonElement | null>(null);
  const profileAnchorRef = useRef<HTMLButtonElement | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [remotesOpen, setRemotesOpen] = useState(false);
  const navItems = props.navItems;
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
            Misty
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
        <div className="flex h-[46px] w-[54px] shrink-0 items-start justify-center pt-3">
          {mistyLogoSource ? (
            <img
              className="h-[34px] w-[34px] object-contain"
              src={mistyLogoSource}
              onError={hideRuntimeAssetOnError}
              onLoad={revealRuntimeAssetOnLoad}
              alt="Misty"
            />
          ) : null}
        </div>
        <div className={navbarGroupClass}>
          <SpaceNavRail />
          {navItems.length ? <NavGroup currentPath={location.pathname} items={navItems} /> : null}
        </div>
        <div className={navbarBottomClass}>
          <ActivityNavButton
            ref={activityAnchorRef}
            open={activityOpen}
            badge={notificationPreferences.badgeCountEnabled ? unreadActivityCount : 0}
            onClick={() => {
              setActivityOpen((open) => !open);
            }}
          />
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
      <ActivityOverlay open={activityOpen} onClose={() => setActivityOpen(false)} />
      <ProfilePopover
        anchorRef={profileAnchorRef}
        currentPath={location.pathname}
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        onOpenAccountSettings={openAccountSettings}
      />
      <RemotesOverlay open={remotesOpen} onClose={closeRemotesOverlay} />
      <SettingsOverlay open={settingsOpen} onClose={closeSettingsOverlay} />
      <DeepSearchOverlay
        activePaneId={activePaneId}
        currentPath={
          activePanePath || frameApp?.environment.homeDir || app?.environment.homeDir || ""
        }
      />
      <MediaSearchViewer />
      <SpacesRealtimeBridge />
    </main>
  );
}
