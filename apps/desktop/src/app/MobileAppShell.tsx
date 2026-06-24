import { memo, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Bell } from "lucide-react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useExplorerStore, type ExplorerNotification } from "../features/explorer/state/useExplorerStore";
import { useProvidersStore } from "../features/providers/useProvidersStore";
import {
  selectNotificationPreferences,
  useSettingsStore,
} from "../features/settings/useSettingsStore";
import { useTransfersStore } from "../features/transfers/useTransfersStore";
import { useAppStore } from "./useAppStore";
import {
  desktopRequiredElement,
  mobileLastRouteStorageKey,
  mobileNavRoutes,
  mobileRouteIdFromPath,
  safeMobileRoute,
} from "./mobileRoutes";

const mobileRouteElements = Object.fromEntries(
  mobileNavRoutes.map((route) => [route.id, route.element]),
) as Record<(typeof mobileNavRoutes)[number]["id"], JSX.Element>;

export function MobileAppShell() {
  const location = useLocation();
  const loadApp = useAppStore((state) => state.loadApp);
  const settingsLoad = useSettingsStore((state) => state.load);
  const providerLoad = useProvidersStore((state) => state.load);
  const transferLoad = useTransfersStore((state) => state.load);
  const notificationPreferences = useSettingsStore(useShallow((state) =>
    selectNotificationPreferences(state.settings?.document),
  ));
  const unreadActivityCount = useExplorerStore((state) => state.notificationHistory.filter((notification) => !notification.read).length);
  const [activityOpen, setActivityOpen] = useState(false);
  const appLoadStarted = useRef(false);
  const routeId = mobileRouteIdFromPath(location.pathname);
  const title = mobileTitle(location.pathname);

  useEffect(() => {
    if (appLoadStarted.current) return;
    appLoadStarted.current = true;
    void loadApp();
    void settingsLoad();
  }, [loadApp, settingsLoad]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.formFactor = "mobile";
    root.dataset.theme = "dark";
    root.dataset.themeMode = "mobile";
    root.dataset.compactMode = "false";
    root.dataset.fontSize = "default";
    root.dataset.reducedMotion = "false";
    root.dataset.thumbnailPreviews = "true";
    root.dataset.uiScale = "default";
    root.style.colorScheme = "dark";
    return () => {
      delete root.dataset.formFactor;
    };
  }, []);

  useEffect(() => {
    if (routeId === "files") void providerLoad(false);
    if (routeId === "providers") void providerLoad(true);
    if (routeId === "transfers") void transferLoad("");
  }, [providerLoad, routeId, transferLoad]);

  useEffect(() => {
    const normalized = safeMobileRoute(normalizeMobileRoute(location.pathname));
    try {
      window.localStorage.setItem(mobileLastRouteStorageKey, normalized);
    } catch {
      // Mobile route memory is a convenience only.
    }
  }, [location.pathname]);

  useEffect(() => {
    const badgeCount = notificationPreferences.badgeCountEnabled && unreadActivityCount > 0
      ? unreadActivityCount
      : undefined;
    try {
      void getCurrentWindow().setBadgeCount(badgeCount).catch(() => {});
    } catch {
      // Browser smoke mode and some platforms do not expose app badges.
    }
  }, [notificationPreferences.badgeCountEnabled, unreadActivityCount]);

  const filesRoute = routeId === "files";

  return (
    <main className={`mobile-app-shell${filesRoute ? " files-mode" : ""}`}>
      {!filesRoute ? (
        <header className="mobile-topbar">
          <div>
            <span>Misty</span>
            <strong>{title}</strong>
          </div>
          <button
            type="button"
            className="mobile-icon-button"
            aria-label="Activity"
            onClick={() => setActivityOpen(true)}
          >
            <Bell size={21} strokeWidth={1.9} />
            {unreadActivityCount > 0 ? <span>{formatBadgeCount(unreadActivityCount)}</span> : null}
          </button>
        </header>
      ) : null}

      <section className="mobile-route-shell">
        <Routes>
          <Route path="/" element={<MobileStartupRedirect />} />
          <Route path="/files" element={mobileRouteElements.files} />
          <Route path="/transfers" element={mobileRouteElements.transfers} />
          <Route path="/providers" element={mobileRouteElements.providers} />
          <Route path="/hub" element={mobileRouteElements.hub} />
          <Route path="/hub/account" element={<Navigate to="/account" replace />} />
          <Route path="/hub/signin" element={<Navigate to="/account/signin" replace />} />
          <Route path="/hub/register" element={<Navigate to="/account/register" replace />} />
          <Route path="/hub/docs/*" element={desktopRequiredElement("Hub documentation")} />
          <Route path="/hub/plugins" element={desktopRequiredElement("Plugin management")} />
          <Route path="/hub/resources/changelog" element={desktopRequiredElement("Hub changelog")} />
          <Route path="/account" element={mobileRouteElements.account} />
          <Route path="/account/signin" element={mobileRouteElements.account} />
          <Route path="/account/register" element={mobileRouteElements.account} />
          <Route path="/settings" element={desktopRequiredElement("Settings")} />
          <Route path="/dock" element={desktopRequiredElement("Plugin panels")} />
          <Route path="/diagnostics" element={desktopRequiredElement("Diagnostics")} />
          <Route path="/activity" element={<Navigate to="/files" replace />} />
          <Route path="*" element={<Navigate to="/files" replace />} />
        </Routes>
      </section>

      <nav className="mobile-tabbar" aria-label="Primary">
        {mobileNavRoutes.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.id}
              to={item.path}
              className={({ isActive }) => {
                const active = item.id === "hub"
                  ? location.pathname.startsWith("/hub")
                  : item.id === "account"
                    ? location.pathname.startsWith("/account")
                    : isActive;
                return active ? "active" : undefined;
              }}
            >
              <Icon size={22} strokeWidth={1.9} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <MobileActivitySheet open={activityOpen} onClose={() => setActivityOpen(false)} />
    </main>
  );
}

function MobileStartupRedirect() {
  let target = "/files";
  try {
    target = safeMobileRoute(normalizeMobileRoute(window.localStorage.getItem(mobileLastRouteStorageKey) ?? "/files"));
  } catch {
    target = "/files";
  }
  return <Navigate to={target} replace />;
}

function normalizeMobileRoute(pathname: string): string {
  if (pathname.startsWith("/transfers")) return "/transfers";
  if (pathname.startsWith("/providers")) return "/providers";
  if (pathname.startsWith("/hub")) return "/hub";
  if (pathname.startsWith("/account")) return "/account";
  if (pathname.startsWith("/files")) return "/files";
  return pathname;
}

const MobileActivitySheet = memo(function MobileActivitySheet(props: { open: boolean; onClose: () => void }) {
  const { history, clearHistory, markRead } = useExplorerStore(useShallow((state) => ({
    history: state.notificationHistory,
    clearHistory: state.clearNotificationHistory,
    markRead: state.markNotificationsRead,
  })));
  const entries = [...history].reverse();

  useEffect(() => {
    if (props.open) markRead();
  }, [markRead, props.open]);

  if (!props.open) return null;

  return (
    <div className="mobile-sheet-backdrop" role="presentation" onClick={props.onClose}>
      <section
        className="mobile-activity-sheet"
        aria-label="Activity"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>Inbox</span>
            <h2>Activity</h2>
          </div>
          <div>
            <button type="button" onClick={clearHistory} disabled={entries.length === 0}>
              Clear
            </button>
            <button type="button" onClick={props.onClose}>
              Done
            </button>
          </div>
        </header>
        {entries.length > 0 ? (
          <div className="mobile-activity-list">
            {entries.map((entry) => <MobileActivityEntry key={entry.id} entry={entry} />)}
          </div>
        ) : (
          <div className="mobile-empty-state">
            <h3>No activity yet</h3>
            <p>Transfer updates and local notices will appear here.</p>
          </div>
        )}
      </section>
    </div>
  );
});

function MobileActivityEntry(props: { entry: ExplorerNotification }) {
  return (
    <article className={`mobile-activity-entry ${props.entry.type}`}>
      <span />
      <div>
        <p>{props.entry.message}</p>
        <time>{formatActivityTime(props.entry.createdAtMs)}</time>
      </div>
    </article>
  );
}

function mobileTitle(pathname: string): string {
  if (pathname.startsWith("/transfers")) return "Transfers";
  if (pathname.startsWith("/providers")) return "Providers";
  if (pathname.startsWith("/hub")) return "Hub";
  if (pathname.startsWith("/account")) return "Account";
  if (pathname !== "/" && !pathname.startsWith("/files")) return "Desktop only";
  return "Files";
}

function formatActivityTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatBadgeCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}
