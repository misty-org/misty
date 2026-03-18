import { memo, useEffect, useRef } from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { ArrowRightLeft, Bell, Blocks, Folder, PanelsTopLeft, Settings as SettingsIcon } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import mistyLogo from "../assets/misty.png";
import { DiagnosticsWorkspace } from "../features/diagnostics/DiagnosticsWorkspace";
import { ExplorerWorkspace } from "../features/explorer/ExplorerWorkspace";
import { useExplorerStore } from "../features/explorer/state/useExplorerStore";
import type { ExplorerNotification } from "../features/explorer/state/useExplorerStore";
import { ProvidersWorkspace } from "../features/providers/ProvidersWorkspace";
import { useProvidersStore } from "../features/providers/useProvidersStore";
import { SettingsWorkspace } from "../features/settings/SettingsWorkspace";
import { useSettingsStore } from "../features/settings/useSettingsStore";
import { TransfersWorkspace } from "../features/transfers/TransfersWorkspace";
import { useTransfersStore } from "../features/transfers/useTransfersStore";
import { useAppStore } from "./useAppStore";
import type { AppTab } from "./types";

const primaryNavItems = [
  { id: "files", label: "Files", path: "/files", icon: Folder },
  { id: "transfers", label: "Transfers", path: "/transfers", icon: ArrowRightLeft },
  { id: "providers", label: "Providers", path: "/providers", icon: PanelsTopLeft },
  { id: "plugins", label: "Plugins", path: "/plugins", icon: Blocks },
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
  const routeId = routeIdFromPath(location.pathname);
  const appLoadStarted = useRef(false);
  const loadedRoutes = useRef(new Set<AppTab>());

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

  return (
    <main className="app-frame">
      <nav className="app-navbar" aria-label="Primary">
        <div className="navbar-logo" title={app?.migrationStage ?? "Misty"}>
          <img src={mistyLogo} alt="Misty" />
        </div>
        <div className="navbar-links">
          <NavGroup items={primaryNavItems} />
        </div>
        <div className="navbar-bottom">
          <NavGroup items={bottomNavItems} badges={{ activity: unreadActivityCount }} />
        </div>
      </nav>

      <section className="route-shell">
        <RouteNotice routeId={routeId} />

        <Routes>
          <Route path="/" element={<Navigate to="/files" replace />} />
          <Route path="/files" element={<ExplorerWorkspace />} />
          <Route path="/providers" element={<ProvidersWorkspace />} />
          <Route path="/transfers" element={<TransfersWorkspace />} />
          <Route path="/plugins" element={<PlaceholderPage title="Plugins" subtitle="Plugin workspace route is registered for the Tauri shell." />} />
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
}) {
  return (
    <>
      {props.items.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink key={item.id} to={item.path}>
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
  if (pathname.startsWith("/plugins")) return "plugins";
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
