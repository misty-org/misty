import { openAccountSettingsInBrowser } from "@/features/account";
import { AgentJobWorker } from "@/features/agents/AgentJobWorker";
import {
  CursorCompanionController,
  useMistyPanelStore,
  WorkflowSchedulesBridge,
} from "@/features/agents";
import { routes, useAppStore, type AppTab } from "@/features/app-shell";
import { useAuth } from "@/features/auth";
import { useExtensionsRuntime } from "@/features/extensions/useExtensionsRuntime";
import { ExtensionPermissionRequest } from "@/features/extensions/ExtensionPermissionRequest";
import { BrowserSearchDialog } from "@/features/browser-workspace/BrowserSearchDialog";
import { BrowserSyncBadge } from "@/features/browser-workspace/BrowserSyncBadge";
import { useBrowserSearchStore } from "@/features/browser-workspace/search";
import { GlobalMisty, useGlobalSearchStore } from "@/features/global-search";
import { BrowserContextMenuBridge } from "@/features/global-search/BrowserContextMenuBridge";
import { NavigationNamesBoundary } from "@/features/navigation-names/NavigationNamesBoundary";
import { useSettingsStore, type SettingsSection } from "@/features/settings";
import { registerShortcutHandler, useShortcutHandler } from "@/features/shortcuts";
import { AppTour, isTourCompletedForAccount, useTourStore } from "@/features/tour";
import { setBrowserWebviewsSuspended } from "@/features/webviews/browserRuntime";
import { BrowserRuntimeBridge } from "@/features/webviews/BrowserRuntimeBridge";
import {
  activeLayoutView,
  allLayoutViews,
  useWindowDockingLayout,
  useWorkspaceStore,
  workspaceSurfaceFromRoute,
} from "@/features/workspace";
import { appZoomRenderScale, useAppZoomValue } from "@/shared/hooks/useAppZoom";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { cn, Pressable } from "@/shared/ui";
import { Minus, Square, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Outlet } from "react-router-dom";
import "./docking.css";
import { dockingGeometry } from "./dockingGeometry";
import { useMergedTitlebar } from "./useMergedTitlebar";
import { useFocusModeShortcuts } from "./useFocusModeShortcuts";
import { WorkspaceWithMistyPanel } from "./WorkspaceWithMistyPanel";
import { useDockingTransition } from "./useDockingTransition";
import { FramePacingOverlay } from "./FramePacingOverlay";
import { GlobalNavigator } from "./GlobalNavigator";
import { settingsFallbackRoute } from "./helpers";
import { NavigatorRail } from "./NavigatorRail";
import {
  navigatorRailWidth,
  useNavigatorLayoutValue,
  publishNavigatorLayout,
  type NavigatorLayout,
} from "./navigatorMode";
import { RestoreGlyph } from "./RestoreGlyph";
import { AppNoticePublisher, RouteNotice } from "./RouteNotices";
import { SettingsOverlay } from "./SettingsOverlays";
import * as styles from "./styles";
import { useDesktopBootstrap } from "./useDesktopBootstrap";
import { useDesktopFrameStyle } from "./useDesktopFrameStyle";
import { useDesktopShellStatus } from "./useDesktopShellStatus";
import { useDesktopWindowChrome } from "./useDesktopWindowChrome";
import { WorkspaceCanvas } from "./WorkspaceCanvas";
export type {
  AppNoticeEntry,
  AppNoticeKind,
  AppNoticeSource,
  DesktopPlatform,
  FramePacingState,
  WindowBounds,
  WindowRect,
} from "@/app/layouts/model/types";

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
  } = useDesktopWindowChrome();
  const appZoom = appZoomRenderScale(useAppZoomValue());
  useDesktopFrameStyle();

  const framePacingOverlayEnabled = useDesktopShellStatus();

  const [profileOpen, setProfileOpen] = useState(false);
  const docking = useWindowDockingLayout();
  const navigatorLayout = useNavigatorLayoutValue();
  const focusMode = useFocusModeShortcuts();
  // Focus mode hides the rail like auto-hide without changing the saved preference.
  const navigatorAutoHide = navigatorLayout.autoHide || focusMode;
  const navigatorLayoutRef = useRef(navigatorLayout);
  navigatorLayoutRef.current = navigatorLayout;
  const navigatorWidth = navigatorRailWidth;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openWorkspaceSurface = useWorkspaceStore((state) => state.openSurface);
  const applyNavigatorLayout = useCallback((next: NavigatorLayout) => {
    setBrowserWebviewsSuspended(true, "navigator-layout");
    publishNavigatorLayout(next);
    useSettingsStore.getState().updateSetting("appearance", "navigator_auto_hide", next.autoHide);
    window.setTimeout(() => setBrowserWebviewsSuspended(false, "navigator-layout"), 320);
  }, []);
  const toggleNavigatorAutoHide = useCallback(() => {
    const current = navigatorLayoutRef.current;
    applyNavigatorLayout({
      ...current,
      autoHide: !current.autoHide,
    });
  }, [applyNavigatorLayout]);
  const refreshUserAfterSettings = useCallback(() => {
    void refreshUser().catch(() => undefined);
  }, [refreshUser]);
  const openSettingsOverlay = useCallback(() => {
    setSettingsOpen(true);
    if (hasTauriInternals() && !useSettingsStore.getState().loaded) void settingsLoad();
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
  useEffect(() => {
    if (!user?.id || transitioning) return;
    const tourState = useTourStore.getState();
    if (!isTourCompletedForAccount(tourState, user.id) && !tourState.isOpen) {
      tourState.startTour();
    }
  }, [user?.id, transitioning]);

  useEffect(() => {
    if (!location.pathname.startsWith("/settings")) return;
    openSettingsOverlay();
    navigate(settingsFallbackRoute(lastNonSettingsRouteRef.current, lastAppRoute), {
      replace: true,
    });
  }, [lastAppRoute, lastNonSettingsRouteRef, location.pathname, navigate, openSettingsOverlay]);

  useEffect(() => {
    const handleOpenSettings = (event: Event) => {
      const section = (event as CustomEvent<{ section?: SettingsSection }>).detail?.section;
      if (section) {
        useSettingsStore.getState().setActiveSection(section);
      }
      openSettingsOverlay();
    };
    const handleCloseSettings = () => {
      closeSettingsOverlay();
    };
    window.addEventListener("misty:open-settings", handleOpenSettings);
    window.addEventListener("misty:close-settings", handleCloseSettings);
    return () => {
      window.removeEventListener("misty:open-settings", handleOpenSettings);
      window.removeEventListener("misty:close-settings", handleCloseSettings);
    };
  }, [closeSettingsOverlay, openSettingsOverlay]);

  useEffect(() => {
    if (!location.pathname.startsWith("/providers")) return;
    navigate(settingsFallbackRoute(lastNonSettingsRouteRef.current, lastAppRoute), {
      replace: true,
    });
  }, [lastAppRoute, lastNonSettingsRouteRef, location.pathname, navigate]);

  useEffect(() => {
    const currentRoute = `${location.pathname}${location.search}${location.hash}`;
    if (currentRoute === routes.newTab || currentRoute.endsWith("/new")) {
      const state = useWorkspaceStore.getState();
      const views = allLayoutViews(state.layout);
      const existingPlaceholder = views.find((v) => v.placeholder);
      if (existingPlaceholder) {
        state.focusView(existingPlaceholder.id);
      }
      return;
    }
    const surface = workspaceSurfaceFromRoute(currentRoute);
    if (surface) {
      if (
        surface.route === currentRoute &&
        activeLayoutView(useWorkspaceStore.getState().layout)?.route === currentRoute
      )
        return;
      const view = openWorkspaceSurface(surface);
      if (view.route !== currentRoute) navigate(view.route, { replace: true });
    }
  }, [location.pathname, location.search, location.hash, navigate, openWorkspaceSurface]);

  useEffect(() => {
    if (location.pathname === "/") {
      const active = activeLayoutView(useWorkspaceStore.getState().layout);
      const target = active ? active.route : routes.newTab;
      navigate(target, { replace: true });
    }
  }, [location.pathname, navigate]);

  const openLauncher = useCallback((commandsOnly = false) => {
    const launcher = useGlobalSearchStore.getState();
    if (commandsOnly) {
      launcher.setQuery(">");
      launcher.activateLauncher();
    } else {
      launcher.togglePanel();
    }
    window.setTimeout(
      () => document.querySelector<HTMLInputElement>("[data-global-misty-launcher-input]")?.focus(),
      0,
    );
  }, []);
  useShortcutHandler(
    "search.toggle",
    useCallback(() => useBrowserSearchStore.getState().toggle(), []),
  );
  useShortcutHandler(
    "app.command_palette",
    useCallback(() => openLauncher(true), [openLauncher]),
  );
  useShortcutHandler("app.open_settings", openSettingsOverlay);
  useShortcutHandler(
    "misty.contextual_companion",
    useCallback(() => useMistyPanelStore.getState().toggle(), []),
  );
  useShortcutHandler("app.toggle_navigator", toggleNavigatorAutoHide);
  useShortcutHandler(
    "navigation.refresh",
    useCallback(() => window.dispatchEvent(new Event("misty:refresh-focused-tool")), []),
  );

  const focusTool = useCallback(
    (tool: string) => {
      const route = `/${tool}`;
      const request = workspaceSurfaceFromRoute(route);
      if (!request) {
        useAppStore.getState().setError(`${tool} is not available in this workspace.`);
        return;
      }
      const tab = useWorkspaceStore.getState().openDestination(request);
      navigate(tab.route, { replace: true });
    },
    [navigate],
  );

  useEffect(() => {
    const tools = ["browser", "agents"];
    const unregister = tools.map((tool) =>
      registerShortcutHandler(`tool.${tool}`, () => focusTool(tool)),
    );
    return () => unregister.forEach((remove) => remove());
  }, [focusTool]);

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
  const titlebarNavigationGeometry = styles.desktopTitlebarNavigationGeometry(
    appZoom,
    shouldShowWindowsControls
      ? styles.windowsTitlebarNavigationInset
      : styles.desktopTitlebarNavigationInset,
  );
  const isAuthRoute = location.pathname === "/signin" || location.pathname === "/register";
  const standaloneRouteTitle = standaloneWorkspaceRouteTitle(location.pathname);
  const sharedTitlebar =
    !isAuthRoute &&
    !standaloneRouteTitle &&
    !focusMode &&
    docking.tabs === "top" &&
    !(docking.navigation === "top" && !navigatorAutoHide);
  const windowsTitlebarControlsRef = useRef<HTMLDivElement>(null);
  const [windowsTitlebarControlsWidth, setWindowsTitlebarControlsWidth] = useState(0);
  useLayoutEffect(() => {
    const windowsControls = windowsTitlebarControlsRef.current;
    const measure = () => {
      setWindowsTitlebarControlsWidth(windowsControls?.offsetWidth ?? 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (windowsControls) observer.observe(windowsControls);
    return () => observer.disconnect();
  }, [isAuthRoute, shouldShowWindowsControls]);
  const tabsFollowNavigator = docking.navigation === "left" && !navigatorAutoHide;
  const geometry = dockingGeometry({
    ...docking,
    autoHide: navigatorAutoHide,
    shareTopBand: !isAuthRoute && !standaloneRouteTitle && !focusMode,
    chromeLeft: titlebarNavigationGeometry.left,
    chromeRight: shouldShowWindowsControls ? (windowsTitlebarControlsWidth || 140) / appZoom : 0,
  });
  const topTabInsets = geometry.titlebarInsets;
  useMergedTitlebar(
    shellRef,
    `${docking.navigation}:${docking.tabs}:${navigatorAutoHide}:${focusMode}`,
    !isAuthRoute,
    titlebarNavigationGeometry.left,
    shouldShowWindowsControls ? (windowsTitlebarControlsWidth || 140) / appZoom : 0,
  );
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
            <div
              ref={windowsTitlebarControlsRef}
              className={styles.windowsTitlebarControlsClass}
              data-misty-window-drag-block="true"
              style={{
                transform: `scale(${titlebarNavigationGeometry.scale})`,
                transformOrigin: "top right",
              }}
            >
              {!isAuthRoute ? (
                <div
                  id="misty-windows-workspace-controls"
                  className={styles.windowsWorkspaceControlsClass}
                  data-misty-window-drag-block="true"
                />
              ) : null}
              <Pressable
                aria-label="Minimize window"
                className={styles.windowsTitlebarControlButtonClass}
                title="Minimize"
                onClick={minimizeTitlebarWindow}
              >
                <Minus size={16} strokeWidth={1.5} />
              </Pressable>
              <Pressable
                className={styles.windowsTitlebarControlButtonClass}
                aria-label={isWindowMaximized ? "Restore window" : "Maximize window"}
                title={isWindowMaximized ? "Restore" : "Maximize"}
                onClick={() => void toggleTitlebarMaximize().catch(() => undefined)}
              >
                {isWindowMaximized ? <RestoreGlyph /> : <Square size={16} strokeWidth={1.5} />}
              </Pressable>
              <Pressable
                aria-label="Close window"
                className={styles.windowsTitlebarCloseButtonClass}
                title="Close"
                onClick={closeTitlebarWindow}
              >
                <X size={16} strokeWidth={1.5} />
              </Pressable>
            </div>
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
              <WorkspaceWithMistyPanel>
                <WorkspaceCanvas
                  windowsTitlebarControls={shouldShowWindowsControls}
                  tabPosition={docking.tabs}
                  titlebarInsets={topTabInsets}
                  hideTabStrip={focusMode}
                />
              </WorkspaceWithMistyPanel>
            )}
            {!isAuthRoute && user?.id ? (
              <CursorCompanionController key={user.id} accountId={user.id} />
            ) : null}
          </>
        </section>

        {!isAuthRoute ? <></> : null}
        <FramePacingOverlay enabled={!isAuthRoute && framePacingOverlayEnabled} />
        {!isAuthRoute ? (
          <>
            <SettingsOverlay open={settingsOpen} onClose={closeSettingsOverlay} />
            {user?.id ? (
              <GlobalMisty
                accountId={user.id}
                currentPath={`${location.pathname}${location.search}`}
                activePaneId={activePaneId}
                activeWorkspacePaneId={activeWorkspacePaneId}
              />
            ) : null}
            <BrowserSearchDialog />
            <BrowserRuntimeBridge />
            <BrowserContextMenuBridge />
            <WorkflowSchedulesBridge />
            <AgentJobWorker />
            <AppTour />
          </>
        ) : null}
      </main>
    </NavigationNamesBoundary>
  );
}

function standaloneWorkspaceRouteTitle(pathname: string): string | null {
  if (import.meta.env.DEV && pathname === "/dev/ui") return "UI gallery";
  if (pathname.startsWith("/invite/")) return "Space invitation";
  return null;
}

function StandaloneRouteSurface(props: { title: string; children: ReactNode }) {
  return (
    <section className="grid h-full min-h-0 grid-rows-[38px_minmax(0,1fr)] overflow-hidden bg-charcoal-bg">
      <header
        data-window-toolbar
        className="flex h-[38px] items-center border-b border-charcoal-border bg-charcoal-workspace px-3"
      >
        <span className="text-sm font-medium text-cream-bright">{props.title}</span>
      </header>
      <div className="min-h-0 overflow-auto">{props.children}</div>
    </section>
  );
}
