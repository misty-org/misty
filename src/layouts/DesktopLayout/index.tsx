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
import { Button } from "@/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { Minus, Square, X } from "lucide-react";
import { hideRuntimeAssetOnError, revealRuntimeAssetOnLoad } from "@/platform/runtimeAsset";
import type { AppTab } from "@/models/types/routing/types";
import {
  selectAssistantPreferences,
  selectNotificationPreferences,
  settingsBoolean,
  useAppRouteMemoryStore,
  useSettingsStore,
} from "@/stores/app";
import { useExplorerStore } from "@/stores/explorer";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import { AppWallpaperVideo } from "../AppWallpaperVideo";
import { DeepSearchOverlay } from "@/features/explorer/components/DeepSearchOverlay";
import { MediaSearchViewer } from "@/features/explorer/components/MediaSearchViewer";
import { SpacesRealtimeBridge } from "@/features/spaces/SpacesRealtimeBridge";
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
} from "./styles";
import { settingsFallbackRoute } from "./helpers";
import { useDesktopWindowChrome } from "./useDesktopWindowChrome";
import { useDesktopFrameStyle } from "./useDesktopFrameStyle";
import { useDesktopBootstrap } from "./useDesktopBootstrap";
import { useCloudFolderBotBridge } from "./useCloudFolderBotBridge";
import { useUnreadBadgeSync } from "./useUnreadBadgeSync";
import { ActivityNavButton, NavGroup, ProfileNavButton, SettingsNavButton } from "./NavRail";
import { ProfilePopover } from "./ProfilePopover";
import { AppNoticePublisher, RouteNotice } from "./RouteNotices";
import { TransferCompletionNotifier, WorkStatusPopup } from "./TransferStatus";
import {
  AccountSettingsOverlay,
  ActivityOverlay,
  RemotesOverlay,
  SettingsOverlay,
} from "./SettingsOverlays";
import { FramePacingOverlay } from "./FramePacingOverlay";

export function DesktopLayout(props: {
  getRouteId: (pathname: string) => AppTab;
  navItems: DesktopNavItem[];
}) {
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
    startTitlebarDrag,
    expandTitlebarWindow,
    togglePseudoMaximize,
    minimizeTitlebarWindow,
    closeTitlebarWindow,
  } = useDesktopWindowChrome();
  const {
    appWallpaperSrc,
    appWallpaperIsVideo,
    mistyLogoSource,
    desktopFrameStyle,
    desktopNavbarStyle,
  } = useDesktopFrameStyle();

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
  const cloudFolderBotEnabled = useSettingsStore(
    (state) => selectAssistantPreferences(state.settings?.document).enabled,
  );
  const framePacingOverlayEnabled = useSettingsStore((state) =>
    settingsBoolean(
      state.settings?.document ?? {},
      "advanced",
      "frame_pacing_overlay_enabled",
      false,
    ),
  );
  const lastSpacesRoute = useAppRouteMemoryStore((state) => state.lastSpacesRoute);

  useCloudFolderBotBridge({
    cloudFolderBotEnabled,
    assetsDir: app?.environment.assetsDir,
  });
  useUnreadBadgeSync({
    badgeCountEnabled: notificationPreferences.badgeCountEnabled,
    unreadActivityCount,
  });

  const activityAnchorRef = useRef<HTMLButtonElement | null>(null);
  const profileAnchorRef = useRef<HTMLButtonElement | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const [remotesOpen, setRemotesOpen] = useState(false);
  const navItems = props.navItems;
  const openSettingsOverlay = useCallback(() => {
    setAccountSettingsOpen(false);
    setSettingsOpen(true);
    void settingsLoad();
  }, [settingsLoad]);
  const closeSettingsOverlay = useCallback(() => {
    setSettingsOpen(false);
  }, []);
  const openAccountSettingsOverlay = useCallback(() => {
    setSettingsOpen(false);
    setAccountSettingsOpen(true);
  }, []);
  const closeAccountSettingsOverlay = useCallback(() => {
    setAccountSettingsOpen(false);
  }, []);
  const openRemotesOverlay = useCallback(() => {
    setSettingsOpen(false);
    setAccountSettingsOpen(false);
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
    if (location.pathname !== "/account") return;
    openAccountSettingsOverlay();
    navigate(settingsFallbackRoute(lastNonSettingsRouteRef.current, lastAppRoute), {
      replace: true,
    });
  }, [
    lastAppRoute,
    lastNonSettingsRouteRef,
    location.pathname,
    navigate,
    openAccountSettingsOverlay,
  ]);

  const shouldShowWindowsControls = shouldShowWindowsTitlebarControls;
  const frameClass = usesNativeWindowChrome ? desktopFrameClass : tabletFrameClass;
  const navbarClass = usesNativeWindowChrome ? desktopNavbarClass : tabletNavbarClass;
  const routeShellClass = usesNativeWindowChrome ? desktopRouteShellClass : tabletRouteShellClass;

  return (
    <main
      className={frameClass}
      data-wallpaper-active={appWallpaperSrc ? "true" : "false"}
      style={desktopFrameStyle}
    >
      {appWallpaperSrc ? (
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
          {appWallpaperIsVideo ? (
            <AppWallpaperVideo src={appWallpaperSrc} />
          ) : (
            <img
              alt=""
              className="h-full w-full object-cover"
              draggable={false}
              src={appWallpaperSrc}
            />
          )}
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,6,7,0.04),rgba(5,6,7,0.16))]" />
        </div>
      ) : null}
      {usesNativeWindowChrome ? (
        <header
          className={desktopTitlebarClass}
          data-tauri-drag-region
          onPointerDown={startTitlebarDrag}
        >
          <div
            className={desktopTitlebarDoubleClickLayerClass}
            onDoubleClick={expandTitlebarWindow}
          />
          <span className={desktopTitlebarTitleClass}>Misty</span>
          {shouldShowWindowsControls ? (
            <div className={windowsTitlebarControlsClass}>
              <Button
                type="button"
                className={windowsTitlebarControlButtonClass}
                aria-label="Minimize window"
                title="Minimize"
                onClick={minimizeTitlebarWindow}
              >
                <Minus size={15} strokeWidth={1.8} />
              </Button>
              <Button
                type="button"
                className={windowsTitlebarControlButtonClass}
                aria-label="Maximize or restore window"
                title="Maximize"
                onClick={() => void togglePseudoMaximize().catch(() => undefined)}
              >
                <Square size={13} strokeWidth={1.8} />
              </Button>
              <Button
                type="button"
                className={windowsTitlebarCloseButtonClass}
                aria-label="Close window"
                title="Close"
                onClick={closeTitlebarWindow}
              >
                <X size={16} strokeWidth={1.8} />
              </Button>
            </div>
          ) : null}
        </header>
      ) : null}

      <nav
        className={navbarClass}
        style={desktopNavbarStyle}
        aria-label="Primary"
        onPointerDown={usesNativeWindowChrome ? startTitlebarDrag : undefined}
      >
        <div className="mb-3 grid h-[62px] w-[62px] place-items-center">
          {mistyLogoSource ? (
            <img
              className="h-[58px] w-[58px] object-contain"
              src={mistyLogoSource}
              onError={hideRuntimeAssetOnError}
              onLoad={revealRuntimeAssetOnLoad}
              alt="Misty"
            />
          ) : null}
        </div>
        <div className={navbarGroupClass}>
          <NavGroup
            currentPath={location.pathname}
            items={navItems}
            routeOverrides={{ spaces: lastSpacesRoute }}
          />
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
      <ActivityOverlay
        open={activityOpen}
        style={desktopFrameStyle}
        onClose={() => setActivityOpen(false)}
      />
      <ProfilePopover
        anchorRef={profileAnchorRef}
        currentPath={location.pathname}
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        onOpenAccountSettings={openAccountSettingsOverlay}
        onOpenSettings={openSettingsOverlay}
      />
      <AccountSettingsOverlay
        open={accountSettingsOpen}
        style={desktopFrameStyle}
        onClose={closeAccountSettingsOverlay}
      />
      <RemotesOverlay open={remotesOpen} style={desktopFrameStyle} onClose={closeRemotesOverlay} />
      <SettingsOverlay
        open={settingsOpen}
        style={desktopFrameStyle}
        onClose={closeSettingsOverlay}
      />
      <DeepSearchOverlay
        activePaneId={activePaneId}
        currentPath={activePanePath || app?.environment.homeDir || ""}
      />
      <MediaSearchViewer />
      <SpacesRealtimeBridge />
    </main>
  );
}
