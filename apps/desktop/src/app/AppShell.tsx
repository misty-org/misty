import { memo, useEffect, useRef } from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { ArrowRightLeft, Bell, Blocks, Folder, PanelsTopLeft, Settings as SettingsIcon } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import mistyLogo from "../assets/misty.png";
import { DiagnosticsWorkspace } from "../features/diagnostics/DiagnosticsWorkspace";
import { ExplorerWorkspace } from "../features/explorer/ExplorerWorkspace";
import { useExplorerStore } from "../features/explorer/state/useExplorerStore";
import type { ExplorerNotification } from "../features/explorer/state/useExplorerStore";
import { HubWorkspace } from "../features/hub/HubWorkspace";
import HubAccountPage from "../features/hub/pages/Account";
import HubDashboardPage from "../features/hub/pages/Dashboard";
import HubHomePage from "../features/hub/pages/Home";
import HubPluginsPage from "../features/hub/pages/Plugins";
import HubRegisterPage from "../features/hub/pages/Register";
import HubSignInPage from "../features/hub/pages/SignIn";
import {
  isRememberableHubRoute,
  useHubRouteMemoryStore,
} from "../features/hub/store/useHubRouteMemoryStore";
import HubChangelogPage from "../features/hub/website/pages/Changelog";
import HubDocsPage from "../features/hub/website/pages/Docs";
import { ProvidersWorkspace } from "../features/providers/ProvidersWorkspace";
import { useProvidersStore } from "../features/providers/useProvidersStore";
import { SettingsWorkspace } from "../features/settings/SettingsWorkspace";
import { useSettingsStore } from "../features/settings/useSettingsStore";
import { TransfersWorkspace } from "../features/transfers/TransfersWorkspace";
import { useTransfersStore } from "../features/transfers/useTransfersStore";
import { useAppStore } from "./useAppStore";
import { useAppThemeStore } from "./useAppThemeStore";
import type { AppTab } from "./types";

const primaryNavItems = [
  { id: "files", label: "Files", path: "/files", icon: Folder },
  { id: "transfers", label: "Transfers", path: "/transfers", icon: ArrowRightLeft },
  { id: "providers", label: "Providers", path: "/providers", icon: PanelsTopLeft },
  { id: "hub", label: "Hub", path: "/hub", icon: Blocks },
] satisfies Array<{ id: AppTab; label: string; path: string; icon: typeof Folder }>;

const bottomNavItems = [
  { id: "activity", label: "Activity", path: "/activity", icon: Bell },
  { id: "settings", label: "Settings", path: "/settings", icon: SettingsIcon },
] satisfies Array<{ id: AppTab; label: string; path: string; icon: typeof Folder }>;

export function AppShell() {
  const location = useLocation();
  const { app, loadApp } = useAppStore(useShallow((state) => ({
    app: state.app,
    loadApp: state.loadApp,
  })));
  const providerLoad = useProvidersStore((state) => state.load);
  const transferLoad = useTransfersStore((state) => state.load);
  const settingsLoad = useSettingsStore((state) => state.load);
  const unreadActivityCount = useExplorerStore((state) => state.notificationHistory.filter((notification) => !notification.read).length);
  const { resolvedTheme, setSystemTheme, themeMode } = useAppThemeStore(useShallow((state) => ({
    resolvedTheme: state.resolvedTheme,
    setSystemTheme: state.setSystemTheme,
    themeMode: state.themeMode,
  })));
  const lastHubRoute = useHubRouteMemoryStore((state) => state.lastHubRoute);
  const rememberHubRoute = useHubRouteMemoryStore((state) => state.rememberHubRoute);
  const routeId = routeIdFromPath(location.pathname);
  const appLoadStarted = useRef(false);
  const loadedRoutes = useRef(new Set<AppTab>());
  const navItems = primaryNavItems.map((item) =>
    item.id === "hub" ? { ...item, path: lastHubRoute } : item,
  );

  useEffect(() => {
    if (appLoadStarted.current) return;
    appLoadStarted.current = true;
    void loadApp();
  }, [loadApp]);

  useEffect(() => {
    if (loadedRoutes.current.has(routeId)) return;
    loadedRoutes.current.add(routeId);
    if (routeId === "files" || routeId === "providers" || routeId === "diagnostics") {
      void providerLoad(routeId === "providers");
    }
    if (routeId === "transfers") void transferLoad("");
    if (routeId === "settings") void settingsLoad();
  }, [providerLoad, routeId, settingsLoad, transferLoad]);

  useEffect(() => {
    if (isRememberableHubRoute(location.pathname)) {
      rememberHubRoute(location.pathname);
    }
  }, [location.pathname, rememberHubRoute]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    root.dataset.themeMode = themeMode;
    root.style.colorScheme = resolvedTheme;
  }, [resolvedTheme, themeMode]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const syncSystemTheme = () => setSystemTheme(query.matches ? "light" : "dark");
    syncSystemTheme();
    query.addEventListener("change", syncSystemTheme);
    return () => query.removeEventListener("change", syncSystemTheme);
  }, [setSystemTheme]);

  return (
    <main className="app-frame">
      <nav className="app-navbar" aria-label="Primary">
        <div className="navbar-logo" title={app?.migrationStage ?? "Misty"}>
          <img src={mistyLogo} alt="Misty" />
        </div>
        <div className="navbar-links">
          <NavGroup currentPath={location.pathname} items={navItems} />
        </div>
        <div className="navbar-bottom">
          <NavGroup currentPath={location.pathname} items={bottomNavItems} badges={{ activity: unreadActivityCount }} />
        </div>
      </nav>

      <section className="route-shell">
        <RouteNotice routeId={routeId} />

        <Routes>
          <Route path="/" element={<Navigate to="/files" replace />} />
          <Route path="/files" element={<ExplorerWorkspace />} />
          <Route path="/providers" element={<ProvidersWorkspace />} />
          <Route path="/transfers" element={<TransfersWorkspace />} />
          <Route path="/hub" element={<HubWorkspace />}>
            <Route index element={<HubHomePage />} />
            <Route path="dashboard" element={<HubDashboardPage />} />
            <Route path="docs/*" element={<HubDocsPage basePath="/hub/docs" />} />
            <Route path="plugins" element={<HubPluginsPage />} />
            <Route path="resources/changelog" element={<HubChangelogPage />} />
            <Route path="account" element={<HubAccountPage />} />
            <Route path="settings" element={<HubAccountPage />} />
            <Route path="signin" element={<HubSignInPage />} />
            <Route path="register" element={<HubRegisterPage />} />
            <Route path="*" element={<Navigate to="/hub" replace />} />
          </Route>
          <Route path="/activity" element={<ActivityWorkspace />} />
          <Route path="/settings" element={<SettingsWorkspace />} />
          <Route path="/diagnostics" element={<DiagnosticsRoute />} />
        </Routes>
      </section>
    </main>
  );
}

const RouteNotice = memo(function RouteNotice(props: { routeId: AppTab }) {
  const appError = useAppStore((state) => state.error);
  const appMessage = useAppStore((state) => state.message);
  const providerError = useProvidersStore((state) => state.error);
  const providerMessage = useProvidersStore((state) => state.message);
  const transferError = useTransfersStore((state) => state.error);
  const transferMessage = useTransfersStore((state) => state.message);
  const settingsError = useSettingsStore((state) => state.error);
  const settingsMessage = useSettingsStore((state) => state.message);
  const notice = noticeForRoute(props.routeId, {
    app: { error: appError, message: appMessage },
    providers: { error: providerError, message: providerMessage },
    transfers: { error: transferError, message: transferMessage },
    settings: { error: settingsError, message: settingsMessage },
  });

  return (
    <>
      {notice.error ? <div className="error global-banner">{notice.error}</div> : null}
      {notice.message ? <div className="message global-banner">{notice.message}</div> : null}
    </>
  );
});

function DiagnosticsRoute() {
  const environment = useAppStore((state) => state.app?.environment ?? null);
  const providerStatus = useProvidersStore((state) => {
    const providers = state.providers;
    if (!providers) return "Starting";
    return providers.health.ready
      ? `Ready${providers.health.version ? ` · ${providers.health.version}` : ""}`
      : providers.health.error || providers.error || "Provider service unavailable";
  });
  return <DiagnosticsWorkspace environment={environment} proxyStatus={providerStatus} />;
}

function NavGroup(props: {
  items: Array<{ id: AppTab; label: string; path: string; icon: typeof Folder }>;
  badges?: Partial<Record<AppTab, number>>;
  currentPath: string;
}) {
  return (
    <>
      {props.items.map((item) => {
        const Icon = item.icon;
        const isHubActive = item.id === "hub" && props.currentPath.startsWith("/hub");
        return (
          <NavLink
            className={({ isActive }) => (isHubActive || isActive ? "active" : undefined)}
            key={item.id}
            to={item.path}
          >
            <span className="navbar-icon-tile">
              <Icon size={22} strokeWidth={1.85} />
              {props.badges?.[item.id] ? (
                <span className="navbar-badge">{formatBadgeCount(props.badges[item.id] ?? 0)}</span>
              ) : null}
            </span>
            <span>{item.label}</span>
          </NavLink>
        );
      })}
    </>
  );
}

function ActivityWorkspace() {
  const { history, clearHistory, markRead } = useExplorerStore(useShallow((state) => ({
    history: state.notificationHistory,
    clearHistory: state.clearNotificationHistory,
    markRead: state.markNotificationsRead,
  })));
  const entries = [...history].reverse();
  const hasEntries = entries.length > 0;

  return (
    <section className="activity-workspace">
      <div className="activity-panel">
        <header>
          <div>
            <h2>Activity</h2>
            <p>Notifications are local to this device.</p>
          </div>
          <div className="activity-actions">
            <button type="button" onClick={markRead} disabled={!hasEntries}>
              Mark Read
            </button>
            <button type="button" onClick={clearHistory} disabled={!hasEntries}>
              Clear
            </button>
          </div>
        </header>
        {hasEntries ? (
          <div className="activity-list">
            {entries.map((entry) => <ActivityEntry key={entry.id} entry={entry} />)}
          </div>
        ) : (
          <div className="activity-empty">
            <h3>No notifications</h3>
            <p>System updates will appear here.</p>
          </div>
        )}
        <footer>Notifications are local to this device.</footer>
      </div>
    </section>
  );
}

function ActivityEntry(props: { entry: ExplorerNotification }) {
  return (
    <article className={`activity-entry ${props.entry.read ? "" : "unread"} ${props.entry.type}`}>
      <span className="activity-entry-dot" />
      <p>{props.entry.message}</p>
      <time>{formatActivityTime(props.entry.createdAtMs)}</time>
    </article>
  );
}

function formatActivityTime(timestampMs: number): string {
  const date = new Date(timestampMs);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatBadgeCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

function PlaceholderPage(props: { title: string; subtitle: string }) {
  return (
    <section className="placeholder-page">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>{props.title}</h2>
            <p>{props.subtitle}</p>
          </div>
        </div>
        <div className="empty">This route is ready for its panel migration.</div>
      </div>
    </section>
  );
}

function routeIdFromPath(pathname: string): AppTab {
  if (pathname.startsWith("/transfers")) return "transfers";
  if (pathname.startsWith("/providers")) return "providers";
  if (pathname.startsWith("/hub")) return "hub";
  if (pathname.startsWith("/activity")) return "activity";
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.startsWith("/diagnostics")) return "diagnostics";
  return "files";
}

function noticeForRoute(
  route: AppTab,
  notices: Record<"app" | "providers" | "transfers" | "settings", { error: string | null; message: string | null }>,
) {
  const scoped = route === "providers" || route === "transfers" || route === "settings" ? notices[route] : notices.app;
  return {
    error: scoped.error ?? notices.app.error,
    message: scoped.message ?? notices.app.message,
  };
}
