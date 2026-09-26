import type { DesktopNavItem } from "@/app/layouts/model/types";
import { openAccountSettingsInBrowser } from "@/features/account";
import { ActivityBridge } from "@/features/activity";
import { AgentJobWorker } from "@/features/agents/AgentJobWorker";
import { CursorCompanionController } from "@/features/agents/companion/CursorCompanionController";
import { routes, useAppStore, type AppTab } from "@/features/app-shell";
import { isSideDock } from "@/features/app-shell/dockingLayout";
import { useAuth } from "@/features/auth";
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
import { Button, cn } from "@/shared/ui";
import { Minus, Square, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Outlet } from "react-router-dom";
import "./docking.css";
import { dockingGeometry } from "./dockingGeometry";
import { FramePacingOverlay } from "./FramePacingOverlay";
import { GlobalNavigator } from "./GlobalNavigator";
import { settingsFallbackRoute } from "./helpers";
import { NavigatorControls } from "./NavigatorControls";
import {
  navigatorPixelWidth,
  readNavigatorLayout,
  writeNavigatorLayout,
  type NavigatorLayout,
} from "./navigatorMode";
import { NavigatorResizeHandle } from "./NavigatorResizeHandle";
import { ProfilePopover } from "./ProfilePopover";
import { RestoreGlyph } from "./RestoreGlyph";
import { AppNoticePublisher, RouteNotice } from "./RouteNotices";
import { SettingsOverlay } from "./SettingsOverlays";
import * as styles from "./styles";
import { TransferCompletionNotifier, WorkStatusPopup } from "./TransferStatus";
import { useDesktopBootstrap } from "./useDesktopBootstrap";
import { useDesktopFrameStyle } from "./useDesktopFrameStyle";
import { useDesktopShellStatus } from "./useDesktopShellStatus";
import { useDesktopWindowChrome } from "./useDesktopWindowChrome";
import { WorkspaceCanvas } from "./WorkspaceCanvas";
export type {
  AppNoticeEntry,
  AppNoticeKind,
  AppNoticeSource,
  DesktopNavItem,
  DesktopPlatform,
  FramePacingState,
  WindowBounds,
  WindowRect,
} from "@/app/layouts/model/types";

export function DesktopLayout(props: {
  getRouteId: (pathname: string) => AppTab;
  navItems: DesktopNavItem[];
}) {
  const { user, refreshUser, transitioning } = useAuth();
  const {
    location,
    navigate,
    app,
    settingsLoad,
    activePaneId,
    activePanePath,
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
  const { app: frameApp } = useDesktopFrameStyle();

  const framePacingOverlayEnabled = useDesktopShellStatus();

  const profileAnchorRef = useRef<HTMLButtonElement | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const docking = useWindowDockingLayout();
  const [navigatorLayout, setNavigatorLayout] = useState<NavigatorLayout>(readNavigatorLayout);
  const [navigatorRevealed, setNavigatorRevealed] = useState(false);
  const navigatorLayoutRef = useRef(navigatorLayout);
  navigatorLayoutRef.current = navigatorLayout;
  const [navigatorResizing, setNavigatorResizing] = useState(false);
  const navigatorWidth = navigatorPixelWidth(navigatorLayout);
  const resizeNavigator = useCallback((widthPx: number) => {
    const next = { ...navigatorLayoutRef.current, widthPx };
    navigatorLayoutRef.current = next;
    setNavigatorLayout(next);
    writeNavigatorLayout(next);
  }, []);
  const changeNavigatorResizing = useCallback((resizing: boolean) => {
    setNavigatorResizing(resizing);
    setBrowserWebviewsSuspended(resizing, "navigator-resize");
  }, []);
  const navigatorHidden = navigatorLayout.visibility === "hidden";
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openWorkspaceSurface = useWorkspaceStore((state) => state.openSurface);
  const applyNavigatorLayout = useCallback((next: NavigatorLayout) => {
    setBrowserWebviewsSuspended(true, "navigator-layout");
    setNavigatorLayout(next);
    writeNavigatorLayout(next);
    window.setTimeout(() => setBrowserWebviewsSuspended(false, "navigator-layout"), 320);
  }, []);
  const toggleNavigatorVisibility = useCallback(() => {
    const current = navigatorLayoutRef.current;
    setNavigatorRevealed(false);
    applyNavigatorLayout({
      ...current,
      visibility: current.visibility === "sticky" ? "hidden" : "sticky",
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
  const openRemotesOverlay = useCallback(() => {
    useSettingsStore.getState().setActiveSection("files-connections");
    openSettingsOverlay();
  }, [openSettingsOverlay]);

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
    openRemotesOverlay();
    navigate(settingsFallbackRoute(lastNonSettingsRouteRef.current, lastAppRoute), {
      replace: true,
    });
  }, [lastAppRoute, lastNonSettingsRouteRef, location.pathname, navigate, openRemotesOverlay]);

  useEffect(() => {
    const currentRoute = `${location.pathname}${location.search}${location.hash}`;
    if (currentRoute === routes.newTab || currentRoute.endsWith("/new")) {
      const state = useWorkspaceStore.getState();
      const views = allLayoutViews(state.layout);
      const existingPlaceholder = views.find((v) => v.placeholder);
      if (existingPlaceholder) {
        state.focusTab(existingPlaceholder.id);
      }
      return;
    }
    const surface = workspaceSurfaceFromRoute(currentRoute);
    if (surface) {
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
  useShortcutHandler("app.toggle_navigator", toggleNavigatorVisibility);
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
      const tab = openWorkspaceSurface(request);
      navigate(tab.route);
    },
    [navigate, openWorkspaceSurface],
  );

  useEffect(() => {
    const tools = ["home", "browser", "files", "agents"];
    const unregister = tools.map((tool) =>
      registerShortcutHandler(`tool.${tool}`, () => focusTool(tool)),
    );
    return () => unregister.forEach((remove) => remove());
  }, [focusTool]);

  useEffect(() => {
    setBrowserWebviewsSuspended(navigatorHidden && navigatorRevealed, "navigator-reveal");
    return () => setBrowserWebviewsSuspended(false, "navigator-reveal");
  }, [navigatorHidden, navigatorRevealed]);

  useEffect(() => {
    setBrowserWebviewsSuspended(profileOpen || settingsOpen, "shell-overlay");
    return () => setBrowserWebviewsSuspended(false, "shell-overlay");
  }, [profileOpen, settingsOpen]);

  useEffect(() => {
    setNavigatorRevealed(false);
    setProfileOpen(false);
    setBrowserWebviewsSuspended(true, "docking-layout");
    const timer = window.setTimeout(
      () => setBrowserWebviewsSuspended(false, "docking-layout"),
      320,
    );
    return () => {
      window.clearTimeout(timer);
      setBrowserWebviewsSuspended(false, "docking-layout");
    };
  }, [docking]);

  const shouldShowWindowsControls = shouldShowWindowsTitlebarControls;
  const titlebarNavigationGeometry = styles.desktopTitlebarNavigationGeometry(
    appZoom,
    shouldShowWindowsControls
      ? styles.windowsTitlebarNavigationInset
      : styles.desktopTitlebarNavigationInset,
  );
  const isAuthRoute = location.pathname === "/signin" || location.pathname === "/register";
  const standaloneRouteTitle = standaloneWorkspaceRouteTitle(location.pathname);
  const sharedTitlebar = !isAuthRoute && !standaloneRouteTitle && docking.tabs === "top";
  const geometry = dockingGeometry(
    docking.navigation,
    navigatorWidth,
    navigatorHidden,
    sharedTitlebar,
  );
  const titlebarControlsRef = useRef<HTMLDivElement>(null);
  const [titlebarControlsWidth, setTitlebarControlsWidth] = useState(0);
  useLayoutEffect(() => {
    const controls = titlebarControlsRef.current;
    if (!controls) return;
    const measure = () => setTitlebarControlsWidth(controls.offsetWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(controls);
    return () => observer.disconnect();
  }, [isAuthRoute]);
  const titlebarControlsLeft = titlebarNavigationGeometry.left;
  const tabsFollowNavigator = docking.navigation === "left" && !navigatorHidden;
  const titlebarReservedWidth =
    titlebarControlsLeft + (titlebarControlsWidth || 112) * titlebarNavigationGeometry.scale + 16;
  const resizeWorkspaceEdge =
    docking.navigation === "left" &&
    docking.tabs === "top" &&
    !navigatorHidden &&
    !standaloneRouteTitle;
  const topTabInsets =
    docking.tabs === "top"
      ? {
          animate: !navigatorResizing,
          // The grid column and this inset transition together, keeping tabs
          // between their two endpoints and clear of the fixed Sync controls.
          // Beside the navigator, the first tab lines up with the pane's edge.
          left: tabsFollowNavigator
            ? Math.max(0, titlebarReservedWidth - navigatorWidth)
            : Math.max(8, titlebarReservedWidth),
          right: shouldShowWindowsControls ? 140 / appZoom : 0,
        }
      : undefined;
  const navigatorContent = (
    <GlobalNavigator
      position={docking.navigation}
      profileAnchorRef={profileAnchorRef}
      profileOpen={profileOpen}
      settingsOpen={settingsOpen || location.pathname.startsWith("/settings")}
      suppressActiveTool={Boolean(standaloneRouteTitle)}
      onProfileClick={() => {
        setSettingsOpen(false);
        setProfileOpen((open) => !open);
      }}
      onSettingsClick={openSettingsOverlay}
      onStartWindowDrag={startTitlebarDrag}
    />
  );
  return (
    <NavigationNamesBoundary userId={user?.id ?? ""} enabled={!isAuthRoute}>
      <main
        className={cn(
          "misty-docking-frame",
          !navigatorResizing &&
            cn(
              "transition-[grid-template-columns,grid-template-rows]",
              styles.navigatorMotionClass,
            ),
        )}
        style={
          isAuthRoute
            ? { gridTemplateColumns: "minmax(0, 1fr)", gridTemplateRows: "38px minmax(0, 1fr)" }
            : geometry.frame
        }
        data-misty-desktop-frame
        data-navigation-position={docking.navigation}
        data-tab-position={docking.tabs}
        data-navigation-resizing={navigatorResizing}
        onPointerDown={(event) => {
          const target = event.target instanceof Element ? event.target : null;
          if (!target?.closest("[data-misty-window-titlebar-region='true']")) return;
          handleDesktopTitlebarPointerDown(event);
        }}
      >
        <header
          className={cn("misty-docking-titlebar", isAuthRoute && "border-b-0 bg-transparent")}
          data-shared-tabs={sharedTitlebar}
          onPointerDown={handleDesktopTitlebarPointerDown}
        >
          {sharedTitlebar ? (
            <div
              className={cn(
                "misty-docking-titlebar-drag-region",
                !navigatorResizing && cn("transition-[width]", styles.navigatorMotionClass),
              )}
              aria-hidden="true"
              style={{ width: tabsFollowNavigator ? navigatorWidth : topTabInsets?.left }}
            />
          ) : null}
          {!isAuthRoute ? (
            <div
              ref={titlebarControlsRef}
              className="misty-docking-titlebar-controls"
              style={{
                left: titlebarControlsLeft,
                transform: `scale(${titlebarNavigationGeometry.scale})`,
                transformOrigin: "top left",
              }}
            >
              <NavigatorControls
                position={docking.navigation}
                visibility={navigatorLayout.visibility}
                onToggleVisibility={toggleNavigatorVisibility}
                iconSize={16 * appZoom}
              />
              <div className="flex shrink-0" data-misty-window-drag-block="true">
                <BrowserSyncBadge
                  key={user?.id}
                  accountId={user?.id ?? ""}
                  onOpenSettings={() => {
                    useSettingsStore.getState().setActiveSection("browser-handoff");
                    openSettingsOverlay();
                  }}
                />
              </div>
              {shouldShowWindowsControls ? (
                <div
                  id="misty-windows-workspace-controls"
                  className={styles.windowsWorkspaceControlsClass}
                  data-misty-window-drag-block="true"
                />
              ) : null}
            </div>
          ) : null}
          {shouldShowWindowsControls ? (
            <div
              className={styles.windowsTitlebarControlsClass}
              data-misty-window-drag-block="true"
              style={{
                transform: `scale(${titlebarNavigationGeometry.scale})`,
                transformOrigin: "top right",
              }}
            >
              <Button
                variant="ghost"
                size="icon-sm"
                className={styles.windowsTitlebarControlButtonClass}
                aria-label="Minimize window"
                title="Minimize"
                onClick={minimizeTitlebarWindow}
              >
                <Minus size={16} strokeWidth={1.5} />
              </Button>
              <Button
                variant="ghost"
                className={styles.windowsTitlebarControlButtonClass}
                aria-label={isWindowMaximized ? "Restore window" : "Maximize window"}
                title={isWindowMaximized ? "Restore" : "Maximize"}
                onClick={() => void toggleTitlebarMaximize().catch(() => undefined)}
              >
                {isWindowMaximized ? <RestoreGlyph /> : <Square size={13} strokeWidth={1.5} />}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className={styles.windowsTitlebarCloseButtonClass}
                aria-label="Close window"
                title="Close"
                onClick={closeTitlebarWindow}
              >
                <X size={18} strokeWidth={1.65} />
              </Button>
            </div>
          ) : null}
        </header>

        {!isAuthRoute ? (
          <div
            className={cn(
              "misty-docking-nav",
              "transition-[transform,opacity]",
              styles.navigatorMotionClass,
            )}
            data-floating={navigatorHidden}
            style={{
              ...(navigatorHidden ? geometry.floating : geometry.navigation),
              transform: navigatorHidden && !navigatorRevealed ? geometry.translate : undefined,
              opacity: navigatorHidden && !navigatorRevealed ? 0 : 1,
              pointerEvents: navigatorHidden && !navigatorRevealed ? "none" : undefined,
            }}
            aria-hidden={navigatorHidden && !navigatorRevealed}
            inert={navigatorHidden && !navigatorRevealed ? true : undefined}
            onPointerLeave={() => {
              if (!navigatorResizing) setNavigatorRevealed(false);
            }}
          >
            {navigatorContent}
            {isSideDock(docking.navigation) && !resizeWorkspaceEdge && (
              <NavigatorResizeHandle
                side={docking.navigation as "left" | "right"}
                width={navigatorWidth}
                zoom={appZoom}
                onChange={resizeNavigator}
                onResizingChange={changeNavigatorResizing}
              />
            )}
          </div>
        ) : null}
        {!isAuthRoute && navigatorHidden ? (
          <div
            className="absolute z-30 cursor-pointer"
            style={geometry.reveal}
            aria-hidden="true"
            onPointerEnter={() => setNavigatorRevealed(true)}
          />
        ) : null}

        <section
          className="route-shell relative z-10 min-h-0 min-w-0 overflow-hidden bg-charcoal-bg"
          style={isAuthRoute ? { gridColumn: 1, gridRow: 2 } : geometry.content}
          data-misty-route-shell
        >
          {!isAuthRoute && resizeWorkspaceEdge && (
            <NavigatorResizeHandle
              workspaceEdge
              width={navigatorWidth}
              zoom={appZoom}
              onChange={resizeNavigator}
              onResizingChange={changeNavigatorResizing}
            />
          )}
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
              />
            )}
            {!isAuthRoute && user?.id ? (
              <CursorCompanionController key={user.id} accountId={user.id} />
            ) : null}
          </>
        </section>

        {!isAuthRoute ? (
          <>
            <WorkStatusPopup />
            <TransferCompletionNotifier />
          </>
        ) : null}
        <FramePacingOverlay enabled={!isAuthRoute && framePacingOverlayEnabled} />
        <div
          id="misty-shell-overlays"
          className="pointer-events-none fixed inset-0 z-[2147482500]"
        />
        {!isAuthRoute ? (
          <>
            <ProfilePopover
              anchorRef={profileAnchorRef}
              currentPath={location.pathname}
              open={profileOpen}
              onClose={() => setProfileOpen(false)}
              onOpenAccountSettings={openAccountSettings}
            />
            <SettingsOverlay open={settingsOpen} onClose={closeSettingsOverlay} />
            {user?.id ? (
              <GlobalMisty
                accountId={user.id}
                currentPath={`${location.pathname}${location.search}`}
                activePaneId={activePaneId}
                activeWorkspacePaneId={activeWorkspacePaneId}
                activePanePath={
                  activePanePath || frameApp?.environment.homeDir || app?.environment.homeDir || ""
                }
              />
            ) : null}
            <BrowserSearchDialog />
            <BrowserRuntimeBridge />
            <BrowserContextMenuBridge />
            <ActivityBridge />
            <AgentJobWorker />
            <AppTour />
          </>
        ) : null}
      </main>
    </NavigationNamesBoundary>
  );
}

function standaloneWorkspaceRouteTitle(pathname: string): string | null {
  if (import.meta.env.DEV && pathname === "/roadmap-preview") return "Roadmap preview";
  if (pathname === "/activity") return "Activity";
  if (pathname.startsWith("/invite/")) return "Space invitation";
  return null;
}

function StandaloneRouteSurface(props: { title: string; children: ReactNode }) {
  return (
    <section className="grid h-full min-h-0 grid-rows-[38px_minmax(0,1fr)] overflow-hidden bg-charcoal-bg">
      <header className="flex h-[38px] items-center border-b border-charcoal-border bg-charcoal-workspace px-3">
        <span className="text-sm font-medium text-cream-bright">{props.title}</span>
      </header>
      <div className="min-h-0 overflow-auto">{props.children}</div>
    </section>
  );
}
