import type { DesktopNavItem } from "@/application/layouts/model/types";
import { openAccountSettingsInBrowser } from "@/features/account";
import { ActivityBridge } from "@/features/activity";
import { useAppStore, type AppTab } from "@/features/app-shell";
import { useAuth } from "@/features/auth";
import { BrowserRuntimeBridge, setBrowserWebviewsSuspended } from "@/features/browser";
import { toggleDesktopMistyPanel } from "@/features/desktop-pet";
import { MediaSearchViewer } from "@/features/files/explorer";
import { GlobalMisty, useGlobalSearchStore } from "@/features/global-search";
import { useSettingsStore, type SettingsSection } from "@/features/settings";
import {
  canonicalSpaceRoute,
  defaultSpaceRoute,
  preferredMistySpace,
  rememberedJournalRoute,
  rememberedPlannerRoute,
  socialProviderPath,
  SpacesRealtimeBridge,
  useSpacesStore,
} from "@/features/spaces";
import {
  registerShortcutHandler,
  useShortcutHandler,
  useShortcutTitle,
} from "@/features/shortcuts";
import {
  canNavigateWorkspaceTabRoute,
  dockLeaves,
  navigateWorkspaceTabRoute,
  useWorkspaceStore,
  workspaceSurfaceFromRoute,
} from "@/features/workspace";
import { cn } from "@/shared/ui";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { ArrowLeft, ArrowRight, Minus, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Outlet, useNavigationType } from "react-router-dom";
import { FramePacingOverlay } from "./FramePacingOverlay";
import { ProfilePopover } from "./ProfilePopover";
import { GlobalNavigator } from "./GlobalNavigator";
import { WorkspaceCanvas } from "./WorkspaceCanvas";
import { NavigatorControls } from "./NavigatorControls";
import {
  navigatorWidths,
  readNavigatorLayout,
  writeNavigatorLayout,
  type NavigatorLayout,
} from "./navigatorMode";
import { AppNoticePublisher, RouteNotice } from "./RouteNotices";
import { RemotesOverlay, SettingsOverlay } from "./SettingsOverlays";
import { TransferCompletionNotifier, WorkStatusPopup } from "./TransferStatus";
import { settingsFallbackRoute } from "./helpers";
import * as styles from "./styles";
import { useDesktopBootstrap } from "./useDesktopBootstrap";
import { useDesktopFrameStyle } from "./useDesktopFrameStyle";
import { useDesktopWindowChrome } from "./useDesktopWindowChrome";
import { useDesktopNavigationHistory } from "./useDesktopNavigationHistory";
import { useDesktopShellStatus } from "./useDesktopShellStatus";
import { RestoreGlyph } from "./RestoreGlyph";
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

export function DesktopLayout(props: {
  getRouteId: (pathname: string) => AppTab;
  navItems: DesktopNavItem[];
}) {
  const { user, refreshUser } = useAuth();
  const spaces = useSpacesStore((state) => state.spaces);
  const spacesSnapshotReady = useSpacesStore((state) => state.snapshotReady);
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
    usesNativeWindowChrome,
    shouldShowWindowsTitlebarControls,
    isWindowMaximized,
    startTitlebarDrag,
    handleDesktopTitlebarPointerDown,
    togglePseudoMaximize,
    minimizeTitlebarWindow,
    closeTitlebarWindow,
  } = useDesktopWindowChrome();
  const { app: frameApp } = useDesktopFrameStyle();
  const navigationType = useNavigationType();

  const framePacingOverlayEnabled = useDesktopShellStatus(navigate);

  const profileAnchorRef = useRef<HTMLButtonElement | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [navigatorLayout, setNavigatorLayout] = useState<NavigatorLayout>(readNavigatorLayout);
  const [navigatorRevealed, setNavigatorRevealed] = useState(false);
  const navigatorLayoutRef = useRef(navigatorLayout);
  navigatorLayoutRef.current = navigatorLayout;
  const navigatorHidden = navigatorLayout.visibility === "hidden";
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [remotesOpen, setRemotesOpen] = useState(false);
  const navigationHistory = useDesktopNavigationHistory({ location, navigate, navigationType });
  const focusedTab = useWorkspaceStore((workspace) => {
    const pane = dockLeaves(workspace.layout.root).find(
      (candidate) => candidate.id === workspace.layout.focusedPaneId,
    );
    return pane?.tabs.find((candidate) => candidate.id === pane.activeTabId) ?? pane?.tabs[0];
  });
  const canGoBack = Boolean(
    (focusedTab && canNavigateWorkspaceTabRoute(focusedTab.id, -1)) || navigationHistory.canGoBack,
  );
  const canGoForward = Boolean(
    (focusedTab && canNavigateWorkspaceTabRoute(focusedTab.id, 1)) ||
    navigationHistory.canGoForward,
  );
  const navigateFocusedTabRoute = useCallback(
    (delta: -1 | 1): boolean => {
      const workspace = useWorkspaceStore.getState();
      const pane = dockLeaves(workspace.layout.root).find(
        (candidate) => candidate.id === workspace.layout.focusedPaneId,
      );
      const tab =
        pane?.tabs.find((candidate) => candidate.id === pane.activeTabId) ?? pane?.tabs[0];
      if (!tab) return false;
      const route = navigateWorkspaceTabRoute(tab.id, delta);
      if (!route) return false;
      workspace.updateTabRoute(tab.id, route);
      navigate(route, { replace: true });
      return true;
    },
    [navigate],
  );
  const goBack = useCallback(() => {
    if (!navigateFocusedTabRoute(-1) && navigationHistory.canGoBack) navigationHistory.goBack();
  }, [navigateFocusedTabRoute, navigationHistory]);
  const goForward = useCallback(() => {
    if (!navigateFocusedTabRoute(1) && navigationHistory.canGoForward)
      navigationHistory.goForward();
  }, [navigateFocusedTabRoute, navigationHistory]);
  const backTitle = useShortcutTitle("Back", "navigation.back");
  const forwardTitle = useShortcutTitle("Forward", "navigation.forward");
  const openWorkspaceSurface = useWorkspaceStore((state) => state.openSurface);
  // A native browser child would smear across the resizing column, so it is
  // parked for the two frames the shell takes to settle.
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
    if (hasTauriInternals()) void settingsLoad();
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
    const handleOpenSettings = (event: Event) => {
      const section = (event as CustomEvent<{ section?: SettingsSection }>).detail?.section;
      if (section) {
        useSettingsStore.getState().setActiveSection(section);
      }
      openSettingsOverlay();
    };
    window.addEventListener("misty:open-settings", handleOpenSettings);
    return () => window.removeEventListener("misty:open-settings", handleOpenSettings);
  }, [openSettingsOverlay]);

  useEffect(() => {
    if (!location.pathname.startsWith("/providers")) return;
    openRemotesOverlay();
    navigate(settingsFallbackRoute(lastNonSettingsRouteRef.current, lastAppRoute), {
      replace: true,
    });
  }, [lastAppRoute, lastNonSettingsRouteRef, location.pathname, navigate, openRemotesOverlay]);

  useEffect(() => {
    if (location.pathname === "/home") {
      const homeSpace = preferredMistySpace(spaces);
      if (homeSpace) {
        navigate(`/spaces/${encodeURIComponent(homeSpace.id)}/home`, { replace: true });
      } else if (spacesSnapshotReady) {
        navigate("/spaces", { replace: true });
      }
      return;
    }
    if (location.pathname === "/spaces") {
      const homeSpace = preferredMistySpace(spaces);
      if (homeSpace && spacesSnapshotReady) {
        navigate(defaultSpaceRoute(homeSpace.id), { replace: true });
      }
      return;
    }
    const currentRoute = `${location.pathname}${location.search}${location.hash}`;
    if (location.pathname.startsWith("/spaces/")) {
      const canonicalRoute = canonicalSpaceRoute(currentRoute);
      if (canonicalRoute !== currentRoute) {
        navigate(canonicalRoute, { replace: true });
        return;
      }
    }
    // Provider and destination choices live in the query string. Keep the
    // complete route on the workspace tab so opening Social cannot fall back
    // to its default Misty destination.
    const surface = workspaceSurfaceFromRoute(currentRoute);
    if (surface) openWorkspaceSurface(surface);
  }, [
    location.pathname,
    location.search,
    location.hash,
    navigate,
    openWorkspaceSurface,
    spaces,
    spacesSnapshotReady,
  ]);

  useEffect(() => {
    if (location.pathname === "/") navigate("/home", { replace: true });
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
  const toggleFloatingMisty = useCallback(() => {
    void toggleDesktopMistyPanel()
      .then((openedNativePanel) => {
        if (!openedNativePanel) openLauncher(false);
      })
      .catch(() => openLauncher(false));
  }, [openLauncher]);
  useShortcutHandler("search.toggle", toggleFloatingMisty);
  useShortcutHandler(
    "app.command_palette",
    useCallback(() => openLauncher(true), [openLauncher]),
  );
  useShortcutHandler("app.open_settings", openSettingsOverlay);
  useShortcutHandler("app.toggle_navigator", toggleNavigatorVisibility);
  useShortcutHandler("navigation.back", goBack, canGoBack);
  useShortcutHandler("navigation.forward", goForward, canGoForward);
  useShortcutHandler(
    "navigation.refresh",
    useCallback(() => window.dispatchEvent(new Event("misty:refresh-focused-tool")), []),
  );

  const focusTool = useCallback(
    (tool: string) => {
      let route = `/${tool}`;
      if (["home", "journal", "planner", "social", "library"].includes(tool)) {
        const availableSpaces = useSpacesStore.getState().spaces;
        const scope = useWorkspaceStore.getState().activeScopeKey;
        const activeSpaceId = scope.startsWith("space:")
          ? scope.slice(6)
          : preferredMistySpace(availableSpaces)?.id;
        if (!activeSpaceId) {
          useAppStore.getState().setError(`Create or join a Space before opening ${tool}.`);
          return;
        }
        const encoded = encodeURIComponent(activeSpaceId);
        if (tool === "home") route = `/spaces/${encoded}/home`;
        else if (tool === "journal") route = rememberedJournalRoute(user?.id ?? "", activeSpaceId);
        else if (tool === "planner") route = rememberedPlannerRoute(user?.id ?? "", activeSpaceId);
        else if (tool === "social") route = socialProviderPath(activeSpaceId, "misty");
        else route = `/spaces/${encoded}/${tool}`;
      }
      const request = workspaceSurfaceFromRoute(route);
      if (!request) {
        useAppStore.getState().setError(`${tool} is not available in this workspace.`);
        return;
      }
      const tab = openWorkspaceSurface(request);
      navigate(tab.route);
    },
    [navigate, openWorkspaceSurface, user?.id],
  );

  useEffect(() => {
    const tools = [
      "home",
      "journal",
      "planner",
      "social",
      "inbox",
      "library",
      "browser",
      "files",
      "code",
      "terminal",
    ];
    const unregister = tools.map((tool) =>
      registerShortcutHandler(`tool.${tool}`, () => focusTool(tool)),
    );
    return () => unregister.forEach((remove) => remove());
  }, [focusTool]);

  // A revealed navigator floats over the workspace, so native browser children
  // have to drop behind the renderer for it to be visible at all.
  useEffect(() => {
    setBrowserWebviewsSuspended(navigatorHidden && navigatorRevealed, "navigator-reveal");
    return () => setBrowserWebviewsSuspended(false, "navigator-reveal");
  }, [navigatorHidden, navigatorRevealed]);

  useEffect(() => {
    setBrowserWebviewsSuspended(profileOpen || settingsOpen || remotesOpen, "shell-overlay");
    return () => setBrowserWebviewsSuspended(false, "shell-overlay");
  }, [profileOpen, remotesOpen, settingsOpen]);

  const shouldShowWindowsControls = shouldShowWindowsTitlebarControls;
  const standaloneRouteTitle = standaloneWorkspaceRouteTitle(location.pathname);
  const frameClass = usesNativeWindowChrome ? styles.desktopFrameClass : styles.tabletFrameClass;
  const navbarClass = usesNativeWindowChrome ? styles.desktopNavbarClass : styles.tabletNavbarClass;
  const routeShellClass = usesNativeWindowChrome
    ? styles.desktopRouteShellClass
    : styles.tabletRouteShellClass;
  const navigatorContent = (
    <GlobalNavigator
      profileAnchorRef={profileAnchorRef}
      profileOpen={profileOpen}
      settingsOpen={settingsOpen || location.pathname.startsWith("/settings")}
      suppressActiveTool={Boolean(standaloneRouteTitle)}
      onProfileClick={() => {
        setSettingsOpen(false);
        setRemotesOpen(false);
        setProfileOpen((open) => !open);
      }}
      onSettingsClick={openSettingsOverlay}
      onStartWindowDrag={usesNativeWindowChrome ? startTitlebarDrag : undefined}
      onTitlebarPointerDown={usesNativeWindowChrome ? handleDesktopTitlebarPointerDown : undefined}
    />
  );
  return (
    <main
      className={cn(
        frameClass,
        "transition-[grid-template-columns] duration-300 ease-in-out",
        navigatorGridClass(navigatorHidden ? "hidden" : "full"),
      )}
      data-misty-desktop-frame
      onPointerDown={(event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target?.closest("[data-misty-window-titlebar-region='true']")) return;
        handleDesktopTitlebarPointerDown(event);
      }}
    >
      {usesNativeWindowChrome ? (
        <header
          className={styles.desktopTitlebarClass}
          onPointerDown={handleDesktopTitlebarPointerDown}
        >
          {!shouldShowWindowsControls ? (
            <div className={cn(styles.desktopTitlebarNavigationClass, "justify-start gap-1")}>
              <NavigatorControls
                visibility={navigatorLayout.visibility}
                onToggleVisibility={toggleNavigatorVisibility}
              />
              <div
                className="flex items-center gap-1"
                data-misty-window-drag-block="true"
                data-misty-desktop-navigation-history="true"
              >
                <button
                  type="button"
                  className={styles.desktopTitlebarNavigationButtonClass}
                  aria-label="Go back"
                  title={backTitle}
                  disabled={!canGoBack}
                  onClick={goBack}
                >
                  <ArrowLeft size={18} />
                </button>
                <button
                  type="button"
                  className={styles.desktopTitlebarNavigationButtonClass}
                  aria-label="Go forward"
                  title={forwardTitle}
                  disabled={!canGoForward}
                  onClick={goForward}
                >
                  <ArrowRight size={18} />
                </button>
              </div>
            </div>
          ) : null}
          {shouldShowWindowsControls ? (
            <div
              className={styles.windowsTitlebarControlsClass}
              data-misty-window-drag-block="true"
            >
              <button
                type="button"
                className={styles.windowsTitlebarControlButtonClass}
                aria-label="Minimize window"
                title="Minimize"
                onClick={minimizeTitlebarWindow}
              >
                <Minus size={13} />
              </button>
              <button
                type="button"
                className={styles.windowsTitlebarControlButtonClass}
                aria-label={isWindowMaximized ? "Restore window" : "Maximize window"}
                title={isWindowMaximized ? "Restore" : "Maximize"}
                onClick={() => void togglePseudoMaximize().catch(() => undefined)}
              >
                {isWindowMaximized ? <RestoreGlyph /> : <Square size={12} />}
              </button>
              <button
                type="button"
                className={styles.windowsTitlebarCloseButtonClass}
                aria-label="Close window"
                title="Close"
                onClick={closeTitlebarWindow}
              >
                <X size={13} />
              </button>
            </div>
          ) : null}
        </header>
      ) : null}

      {!usesNativeWindowChrome ? (
        <div className="absolute left-2 top-1 z-[60]" data-misty-window-drag-block="true">
          <NavigatorControls
            visibility={navigatorLayout.visibility}
            onToggleVisibility={toggleNavigatorVisibility}
          />
        </div>
      ) : null}

      <div
        className={cn(
          navbarClass,
          "w-[264px] transition-all duration-300 ease-in-out",
          navigatorHidden
            ? "-translate-x-full opacity-0 pointer-events-none"
            : "translate-x-0 opacity-100 pointer-events-auto",
        )}
        aria-hidden={navigatorHidden}
        inert={navigatorHidden ? true : undefined}
      >
        {navigatorContent}
      </div>

      {navigatorHidden ? (
        <div
          className={cn(
            usesNativeWindowChrome
              ? styles.desktopFloatingNavbarClass
              : styles.tabletFloatingNavbarClass,
            "w-[264px] transition-all duration-300 ease-in-out",
            navigatorRevealed
              ? "translate-x-0 opacity-100 shadow-[0_18px_44px_rgba(0,0,0,0.6)] pointer-events-auto"
              : "-translate-x-full opacity-0 pointer-events-none shadow-none",
          )}
          aria-hidden={!navigatorRevealed}
          inert={!navigatorRevealed ? true : undefined}
          onPointerLeave={() => setNavigatorRevealed(false)}
        >
          {navigatorContent}
        </div>
      ) : null}

      {navigatorHidden ? (
        <div
          className={styles.navigatorRevealStripClass}
          aria-hidden="true"
          onPointerEnter={() => setNavigatorRevealed(true)}
        />
      ) : null}

      <section className={`${routeShellClass} route-shell`} data-misty-route-shell>
        <AppNoticePublisher />
        <RouteNotice routeId={routeId} />

        {standaloneRouteTitle ? (
          <StandaloneRouteSurface title={standaloneRouteTitle}>
            <Outlet />
          </StandaloneRouteSurface>
        ) : (
          <WorkspaceCanvas
            titlebarInsets={
              usesNativeWindowChrome
                ? {
                    left: Math.max(
                      0,
                      (shouldShowWindowsControls
                        ? styles.windowsTitlebarControlsEnd
                        : styles.desktopTitlebarControlsEnd) -
                        (navigatorHidden ? 0 : navigatorWidths[navigatorLayout.width]) -
                        styles.dockHeaderPadding,
                    ),
                    right: shouldShowWindowsControls ? 140 : 0,
                  }
                : undefined
            }
          />
        )}
      </section>

      <WorkStatusPopup />
      <TransferCompletionNotifier />
      <FramePacingOverlay enabled={framePacingOverlayEnabled} />
      <div id="misty-shell-overlays" className="pointer-events-none fixed inset-0 z-[2147482500]" />
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
          activeWorkspacePaneId={activeWorkspacePaneId}
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

const navigatorGridClass = (width: "full" | "hidden") =>
  width === "hidden" ? "grid-cols-[0px_minmax(0,1fr)]" : "grid-cols-[264px_minmax(0,1fr)]";

function standaloneWorkspaceRouteTitle(pathname: string): string | null {
  if (import.meta.env.DEV && pathname === "/roadmap-preview") return "Roadmap preview";
  if (pathname === "/signin") return "Sign in";
  if (pathname === "/register") return "Create account";
  if (pathname.startsWith("/invite/")) return "Join Space";
  if (pathname === "/spaces") return "Spaces";
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
