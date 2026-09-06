import type { AppTab } from "@/features/app-shell";
import { useAppStore } from "@/features/app-shell";
import { ActivityBridge, useActivityStore } from "@/features/activity";
import { useAuth } from "@/features/auth";
import { GlobalMisty, useGlobalSearchStore } from "@/features/global-search";
import { SettingsWorkspace, useSettingsStore } from "@/features/settings";
import {
  canonicalSpaceRoute,
  preferredDefaultSpace,
  rememberedPlannerRoute,
  socialProviderPath,
  useSpacesStore,
} from "@/features/spaces";
import { SpacesRealtimeBridge } from "@/features/spaces/SpacesRealtimeBridge";
import {
  dockLeaves,
  flattenWorkspaceTabs,
  groupWorkspaceTabsByWindow,
  useWorkspaceStore,
  workspaceSurfaceFromRoute,
  type WorkspaceSurfaceId,
  type WorkspaceTabProjection,
} from "@/features/workspace/core";
import { cn, Sheet, SheetContent } from "@/shared/ui";
import {
  MobileSurfaceProvider,
  useMobileStagePresentation,
  type MobileSurfaceChromeConfig,
} from "@/shared/mobile";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { requestEmbeddedBrowserSuspension } from "@/shared/platform/browserSuspensionSignal";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { MobileTopBar } from "./MobileChrome";
import { MobileNavigation, mobileNavigationIcons } from "./MobileNavigation";
import { MobileTabOverview } from "./MobileTabOverview";
import { MobileWorkspace } from "./MobileWorkspace";
import { MobileLifecycleBridge } from "./MobileLifecycleBridge";
import { MobileNotificationBridge } from "./MobileNotificationBridge";

// The bridge is a platform host service, not App UI. Browser App commands will
// move behind a dedicated SDK capability as the compatibility package migrates.
const LazyBrowserRuntimeBridge = lazy(() =>
  import("@/features/browser/BrowserRuntimeBridge").then((module) => ({
    default: module.BrowserRuntimeBridge,
  })),
);

const excludedMobileSurfaces = new Set<WorkspaceSurfaceId>(["extension", "marketplace"]);

export function MobileLayout(props: { getRouteId: (pathname: string) => AppTab }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const spaces = useSpacesStore((state) => state.spaces);
  const spacesReady = useSpacesStore((state) => state.snapshotReady);
  const activeScopeKey = useWorkspaceStore((state) => state.activeScopeKey);
  const virtualWindowsByScope = useWorkspaceStore((state) => state.virtualWindowsByScope);
  const layout = useWorkspaceStore((state) => state.layout);
  const projections = useMemo(
    () =>
      flattenWorkspaceTabs(
        { activeScopeKey, virtualWindowsByScope },
        { excludeSurfaceIds: excludedMobileSurfaces },
      ),
    [activeScopeKey, virtualWindowsByScope],
  );
  const windowProjections = useMemo(
    () =>
      groupWorkspaceTabsByWindow(
        { activeScopeKey, virtualWindowsByScope },
        { excludeSurfaceIds: excludedMobileSurfaces },
      ),
    [activeScopeKey, virtualWindowsByScope],
  );
  const activeVirtualWindowId = useWorkspaceStore((state) => state.activeVirtualWindowId);
  const attentionCount = useActivityStore((state) => state.attentionCount);
  const loadApp = useAppStore((state) => state.loadApp);
  const loadSettings = useSettingsStore((state) => state.load);
  const app = useAppStore((state) => state.app);
  const [tabsOpen, setTabsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [surfaceChrome, setSurfaceChrome] = useState<MobileSurfaceChromeConfig | null>(null);
  const { presentation, stageRef } = useMobileStagePresentation();
  const loadStarted = useRef(false);
  const lastWorkspaceRoute = useRef("/spaces");
  const activeSpace =
    spaces.find((space) => `space:${space.id}` === activeScopeKey) ?? preferredDefaultSpace(spaces);
  const activeTab = useMemo(() => {
    const panes = dockLeaves(layout.root);
    const pane = panes.find((candidate) => candidate.id === layout.focusedPaneId) ?? panes[0];
    return pane?.tabs.find((tab) => tab.id === pane.activeTabId) ?? pane?.tabs[0] ?? null;
  }, [layout]);
  props.getRouteId(location.pathname);

  useEffect(() => {
    if (loadStarted.current) return;
    loadStarted.current = true;
    if (!hasTauriInternals()) return;
    void loadApp();
    void loadSettings();
  }, [loadApp, loadSettings]);

  useEffect(() => {
    if (location.pathname === "/") {
      navigate("/home", { replace: true });
      return;
    }
    if (location.pathname === "/home") {
      const space = activeSpace ?? preferredDefaultSpace(spaces);
      if (space) navigate(`/spaces/${encodeURIComponent(space.id)}/home`, { replace: true });
      else if (spacesReady) navigate("/spaces", { replace: true });
      return;
    }
    if (location.pathname === "/spaces") {
      const space = activeSpace ?? preferredDefaultSpace(spaces);
      if (space && spacesReady)
        navigate(`/spaces/${encodeURIComponent(space.id)}/home`, { replace: true });
      return;
    }
    if (location.pathname.startsWith("/spaces/")) {
      const route = `${location.pathname}${location.search}${location.hash}`;
      const canonical = canonicalSpaceRoute(route);
      if (canonical !== route) {
        navigate(canonical, { replace: true });
        return;
      }
    }
    if (location.pathname.startsWith("/settings")) {
      setSettingsOpen(true);
      navigate(lastWorkspaceRoute.current, { replace: true });
      return;
    }
    if (!standaloneMobileRoute(location.pathname)) {
      lastWorkspaceRoute.current = `${location.pathname}${location.search}`;
      const request = workspaceSurfaceFromRoute(lastWorkspaceRoute.current);
      if (request) useWorkspaceStore.getState().openSurface(request);
    }
  }, [
    location.hash,
    location.pathname,
    location.search,
    navigate,
    activeSpace,
    spaces,
    spacesReady,
  ]);

  useEffect(() => {
    requestEmbeddedBrowserSuspension(tabsOpen || settingsOpen, "mobile-shell-overlay");
    return () => requestEmbeddedBrowserSuspension(false, "mobile-shell-overlay");
  }, [settingsOpen, tabsOpen]);

  useEffect(() => {
    const showNotice = (event: Event) => {
      const message = (event as CustomEvent<{ message?: string }>).detail?.message?.trim();
      if (!message) return;
      setNotice(message);
      window.setTimeout(() => setNotice((current) => (current === message ? "" : current)), 4000);
    };
    window.addEventListener("misty:mobile-notice", showNotice);
    return () => window.removeEventListener("misty:mobile-notice", showNotice);
  }, []);

  useEffect(() => {
    let message = "";
    try {
      message = sessionStorage.getItem("misty:mobile-route-notice")?.trim() ?? "";
      sessionStorage.removeItem("misty:mobile-route-notice");
    } catch {
      return;
    }
    if (!message) return;
    setNotice(message);
    const timer = window.setTimeout(
      () => setNotice((current) => (current === message ? "" : current)),
      4000,
    );
    return () => window.clearTimeout(timer);
  }, [location.pathname]);

  const openPath = useCallback(
    (path: string) => {
      if (path === "/settings") {
        setSettingsOpen(true);
        return;
      }
      const request = workspaceSurfaceFromRoute(path);
      if (request) useWorkspaceStore.getState().openSurface(request);
      navigate(path);
    },
    [navigate],
  );

  const selectTab = useCallback(
    (entry: WorkspaceTabProjection) => {
      const workspace = useWorkspaceStore.getState();
      if (entry.windowId !== workspace.activeVirtualWindowId)
        workspace.switchVirtualWindow(entry.windowId);
      workspace.focusTab(entry.tab.id);
      setTabsOpen(false);
      navigate(entry.tab.route);
    },
    [navigate],
  );

  const closeTab = useCallback(
    (entry: WorkspaceTabProjection) => {
      const workspace = useWorkspaceStore.getState();
      if (
        entry.windowId !== workspace.activeVirtualWindowId &&
        !workspace.switchVirtualWindow(entry.windowId)
      ) {
        return;
      }
      if (!useWorkspaceStore.getState().closeTab(entry.tab.id, entry.paneId)) return;
      const current = useWorkspaceStore.getState();
      const panes = dockLeaves(current.layout.root);
      const pane =
        panes.find((candidate) => candidate.id === current.layout.focusedPaneId) ?? panes[0];
      const tab =
        pane?.tabs.find((candidate) => candidate.id === pane.activeTabId) ?? pane?.tabs[0];
      if (tab) navigate(tab.route);
    },
    [navigate],
  );

  const createWindow = useCallback(() => {
    const workspace = useWorkspaceStore.getState();
    const created = workspace.createVirtualWindow();
    const panes = dockLeaves(created.layout.root);
    const pane =
      panes.find((candidate) => candidate.id === created.layout.focusedPaneId) ?? panes[0];
    const tab = pane?.tabs.find((candidate) => candidate.id === pane.activeTabId) ?? pane?.tabs[0];
    setTabsOpen(false);
    if (tab && !excludedMobileSurfaces.has(tab.surfaceId)) {
      navigate(tab.route);
      return;
    }
    const path = activeSpace ? `/spaces/${encodeURIComponent(activeSpace.id)}/home` : "/home";
    const request = workspaceSurfaceFromRoute(path);
    if (request) useWorkspaceStore.getState().openSurface(request);
    navigate(path);
  }, [activeSpace, navigate]);

  const selectSpace = useCallback(
    (spaceId: string) => {
      const path = `/spaces/${encodeURIComponent(spaceId)}/home`;
      useWorkspaceStore.getState().setScope(`space:${spaceId}`);
      openPath(path);
    },
    [openPath],
  );

  const openAccount = useCallback(() => {
    if (user) {
      navigate("/profile");
      return;
    }
    navigate("/signin", {
      state: { from: lastWorkspaceRoute.current || "/home" },
    });
  }, [navigate, user]);

  const openSearch = useCallback(() => {
    useGlobalSearchStore.getState().togglePanel();
    window.setTimeout(
      () => document.querySelector<HTMLInputElement>("[data-global-misty-launcher-input]")?.focus(),
      0,
    );
  }, []);

  const spaceId = activeSpace?.id ?? "";
  const core = [
    {
      id: "home",
      label: "Home",
      path: spaceId ? `/spaces/${encodeURIComponent(spaceId)}/home` : "/spaces",
      icon: mobileNavigationIcons.home,
    },
    {
      id: "chat",
      label: "Chat",
      path: spaceId ? socialProviderPath(spaceId, "misty") : "/spaces",
      icon: mobileNavigationIcons.chat,
    },
    {
      id: "planner",
      label: "Planner",
      path: spaceId ? rememberedPlannerRoute(user?.id ?? "", spaceId) : "/spaces",
      icon: mobileNavigationIcons.planner,
    },
  ];
  const more = [
    { id: "inbox", label: "Inbox", path: "/inbox", icon: mobileNavigationIcons.inbox },
    { id: "agents", label: "Agents", path: "/agents", icon: mobileNavigationIcons.agents },
    { id: "browser", label: "Browser", path: "/browser", icon: mobileNavigationIcons.browser },
    { id: "files", label: "Files", path: "/files", icon: mobileNavigationIcons.files },
    { id: "activity", label: "Activity", path: "/activity", icon: mobileNavigationIcons.inbox },
    { id: "settings", label: "Settings", path: "/settings", icon: mobileNavigationIcons.settings },
  ];
  const standalone = standaloneMobileRoute(location.pathname);
  const authenticationRoute = location.pathname === "/signin" || location.pathname === "/register";

  return (
    <MobileSurfaceProvider presentation={presentation} onChromeChange={setSurfaceChrome}>
      <main
        className={cn(
          "relative grid h-full min-h-0 grid-cols-1 overflow-hidden bg-charcoal-workspace text-cream",
          authenticationRoute
            ? "grid-rows-[minmax(0,1fr)]"
            : "grid-rows-[48px_minmax(0,1fr)_auto] pt-[env(safe-area-inset-top)] min-[1024px]:grid-cols-[280px_minmax(0,1fr)] min-[1024px]:grid-rows-[48px_minmax(0,1fr)]",
        )}
        data-misty-mobile-frame
      >
        {!authenticationRoute ? (
          <>
            <div className="col-start-1 row-start-2 hidden min-h-0 min-[1024px]:flex">
              <MobileNavigation
                activePath={location.pathname}
                activeSpaceId={spaceId}
                spaces={spaces}
                core={core}
                more={more}
                account={user ? { name: user.name || user.email, email: user.email } : null}
                onAccount={openAccount}
                onNavigate={openPath}
                onSelectSpace={selectSpace}
              />
            </div>
            <div className="col-start-1 row-start-1 min-[1024px]:col-span-2">
              <MobileTopBar
                title={
                  standalone ? standaloneTitle(location.pathname) : activeTab?.title || "Misty"
                }
                attentionCount={attentionCount}
                tabCount={projections.length}
                onBack={() => navigate(-1)}
                onActivity={() => openPath("/activity")}
                onSearch={openSearch}
                onTabs={() => setTabsOpen(true)}
                surfaceChrome={surfaceChrome}
              />
            </div>
          </>
        ) : null}
        <section
          ref={stageRef}
          className={cn(
            "col-start-1 min-h-0 overflow-hidden bg-charcoal-bg",
            authenticationRoute ? "row-start-1" : "row-start-2 min-[1024px]:col-start-2",
          )}
          data-mobile-presentation={presentation}
        >
          {standalone ? <Outlet /> : <MobileWorkspace />}
        </section>
        {!authenticationRoute ? (
          <div className="col-start-1 row-start-3 min-[1024px]:hidden">
            <MobileNavigation
              activePath={location.pathname}
              activeSpaceId={spaceId}
              spaces={spaces}
              core={core}
              more={more}
              account={user ? { name: user.name || user.email, email: user.email } : null}
              onAccount={openAccount}
              onNavigate={openPath}
              onSelectSpace={selectSpace}
            />
          </div>
        ) : null}

        <MobileTabOverview
          open={tabsOpen}
          windows={windowProjections}
          activeWindowId={activeVirtualWindowId}
          activeTabId={activeTab?.id}
          onOpenChange={setTabsOpen}
          onSelect={selectTab}
          onCloseTab={closeTab}
          onCreateWindow={createWindow}
        />
        <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
          <SheetContent
            side="bottom"
            showCloseButton={false}
            className="h-[calc(100dvh-env(safe-area-inset-top))] max-h-none gap-0 rounded-none p-0"
          >
            <SettingsWorkspace presentation="mobile" onClose={() => setSettingsOpen(false)} />
          </SheetContent>
        </Sheet>
        {notice ? (
          <p
            className="fixed left-1/2 top-[max(60px,calc(60px+env(safe-area-inset-top)))] z-[2147483200] max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-lg bg-charcoal-active px-3 py-2 text-center text-sm text-cream-bright shadow-xl"
            role="status"
          >
            {notice}
          </p>
        ) : null}

        {user?.id ? (
          <GlobalMisty
            accountId={user.id}
            currentPath={`${location.pathname}${location.search}`}
            activePaneId=""
            activeWorkspacePaneId={layout.focusedPaneId}
            activePanePath={app?.environment.homeDir || ""}
          />
        ) : null}
        <Suspense fallback={null}>
          <LazyBrowserRuntimeBridge />
        </Suspense>
        <MobileLifecycleBridge />
        <MobileNotificationBridge />
        <SpacesRealtimeBridge />
        <ActivityBridge />
      </main>
    </MobileSurfaceProvider>
  );
}

function standaloneMobileRoute(pathname: string): boolean {
  return (
    pathname === "/activity" ||
    pathname === "/profile" ||
    pathname === "/signin" ||
    pathname === "/register" ||
    pathname.startsWith("/invite/")
  );
}

function standaloneTitle(pathname: string): string {
  if (pathname === "/activity") return "Activity";
  if (pathname === "/profile") return "Profile";
  if (pathname === "/signin") return "Sign in";
  if (pathname === "/register") return "Create account";
  if (pathname.startsWith("/invite/")) return "Join Space";
  return "Misty";
}
