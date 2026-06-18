import { useEffect } from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { ArrowRightLeft, Bell, Blocks, Folder, PanelsTopLeft, Settings as SettingsIcon } from "lucide-react";
import mistyLogo from "../assets/misty.png";
import { DiagnosticsWorkspace } from "../features/diagnostics/DiagnosticsWorkspace";
import { ExplorerWorkspace } from "../features/explorer/ExplorerWorkspace";
import { ProvidersWorkspace } from "../features/providers/ProvidersWorkspace";
import { selectProviderDerived, useProvidersStore } from "../features/providers/useProvidersStore";
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
  const { app, loadApp, error: appError, message: appMessage } = useAppStore();
  const providersState = useProvidersStore();
  const transfersState = useTransfersStore();
  const settingsState = useSettingsStore();
  const providerDerived = selectProviderDerived(providersState);
  const routeId = routeIdFromPath(location.pathname);

  useEffect(() => {
    void loadApp();
    void providersState.load(true);
    void transfersState.load("");
    void settingsState.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const notice = noticeForRoute(routeId, {
    app: { error: appError, message: appMessage },
    providers: { error: providersState.error, message: providersState.message },
    transfers: { error: transfersState.error, message: transfersState.message },
    settings: { error: settingsState.error, message: settingsState.message },
  });

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
          <NavGroup items={bottomNavItems} />
        </div>
      </nav>

      <section className="route-shell">
        {notice.error ? <div className="error global-banner">{notice.error}</div> : null}
        {notice.message ? <div className="message global-banner">{notice.message}</div> : null}

        <Routes>
          <Route path="/" element={<Navigate to="/files" replace />} />
          <Route path="/files" element={<ExplorerWorkspace />} />
          <Route path="/providers" element={<ProvidersWorkspace />} />
          <Route path="/transfers" element={<TransfersWorkspace />} />
          <Route path="/plugins" element={<PlaceholderPage title="Plugins" subtitle="Plugin workspace route is registered for the Tauri shell." />} />
          <Route path="/activity" element={<PlaceholderPage title="Activity" subtitle="Activity workspace route is registered for the Tauri shell." />} />
          <Route path="/settings" element={<SettingsWorkspace />} />
          <Route path="/diagnostics" element={<DiagnosticsWorkspace environment={app?.environment ?? null} proxyStatus={providerDerived.status} />} />
        </Routes>
      </section>
    </main>
  );
}

function NavGroup(props: {
  items: Array<{ id: AppTab; label: string; path: string; icon: typeof Folder }>;
}) {
  return (
    <>
      {props.items.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink key={item.id} to={item.path}>
            <span className="navbar-icon-tile">
              <Icon size={24} strokeWidth={1.85} />
            </span>
            <span>{item.label}</span>
          </NavLink>
        );
      })}
    </>
  );
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
