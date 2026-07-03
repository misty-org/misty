import { memo, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Bell } from "lucide-react";
import { Navigate, NavLink, useLocation, useRoutes } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useExplorerStore, type ExplorerNotification } from "../stores/useExplorerStore";
import { useProvidersStore } from "../stores/useProvidersStore";
import {
  selectNotificationPreferences,
  useSettingsStore,
} from "../stores/useSettingsStore";
import { useAppStore } from "../stores/useAppStore";
import {
  mobileLastRouteStorageKey,
  mobileNavRoutes,
  mobileRouteIdFromPath,
  safeMobileRoute,
} from "./mobileRoutes";
import { hasTauriInternals } from "../shared/tauri";

const mobileRouteElements = Object.fromEntries(
  mobileNavRoutes.map((route) => [route.id, route.element]),
) as Record<(typeof mobileNavRoutes)[number]["id"], JSX.Element>;

const mobileShellBaseClass = "grid h-[100dvh] min-h-0 w-full min-w-0 overflow-hidden bg-[#05070a] text-[#f4f0e8]";
const mobileShellRowsClass = "grid-rows-[auto_minmax(0,1fr)_calc(var(--misty-mobile-tabbar-height)+var(--misty-safe-bottom))]";
const mobileShellFilesRowsClass = "grid-rows-[minmax(0,1fr)_calc(var(--misty-mobile-tabbar-height)+var(--misty-safe-bottom))]";
const mobileTopbarClass = "flex min-w-0 items-center justify-between gap-3 border-b border-white/10 bg-[rgba(5,7,10,0.94)] px-[max(var(--misty-mobile-edge),var(--misty-safe-right))] pb-2.5 pl-[max(var(--misty-mobile-edge),var(--misty-safe-left))] pt-[calc(12px+var(--misty-safe-top))]";
const mobileIconButtonClass = "relative grid h-[38px] w-[38px] flex-none place-items-center rounded-xl border border-white/10 bg-[#101720] text-[#eef3fb] disabled:opacity-45";
const mobileBadgeClass = "absolute -right-1.5 -top-1.5 grid h-[19px] min-w-[19px] place-items-center rounded-full bg-[#e14856] px-1.5 text-[10px] font-extrabold leading-none text-white";
const mobileRouteShellClass = "relative z-50 min-h-0 min-w-0 overflow-hidden";
const mobileTabbarClass = "relative z-40 grid h-[calc(var(--misty-mobile-tabbar-height)+var(--misty-safe-bottom))] min-w-0 grid-cols-[repeat(auto-fit,minmax(50px,1fr))] gap-1 border-t border-white/10 px-[max(8px,var(--misty-safe-right))] pb-[calc(8px+var(--misty-safe-bottom))] pl-[max(8px,var(--misty-safe-left))] pt-[7px]";
const mobileTabClass = "grid h-full min-w-0 place-items-center gap-[3px] rounded-none text-[10px] font-bold text-[#a3adba] no-underline";
const mobileTabActiveClass = "bg-transparent text-[#f7f3ec]";

export function MobileAppShell() {
  const location = useLocation();
  const loadApp = useAppStore((state) => state.loadApp);
  const settingsLoad = useSettingsStore((state) => state.load);
  const providerLoad = useProvidersStore((state) => state.load);
  const notificationPreferences = useSettingsStore(useShallow((state) =>
    selectNotificationPreferences(state.settings?.document),
  ));
  const unreadActivityCount = useExplorerStore((state) => state.notificationHistory.filter((notification) => !notification.read).length);
  const [activityOpen, setActivityOpen] = useState(false);
  const appLoadStarted = useRef(false);
  const routeId = mobileRouteIdFromPath(location.pathname);
  const title = mobileTitle(location.pathname);
  const routeElement = useRoutes([
    { path: "/", element: <MobileStartupRedirect /> },
    { path: "/files", element: mobileRouteElements.files },
    { path: "/transfers", element: <Navigate to="/files" replace /> },
    { path: "/providers", element: mobileRouteElements.providers },
    { path: "/home/*", element: <Navigate to="/files" replace /> },
    { path: "/extensions/*", element: <Navigate to="/files" replace /> },
    { path: "/account", element: mobileRouteElements.account },
    { path: "/account/signin", element: mobileRouteElements.account },
    { path: "/account/register", element: mobileRouteElements.account },
    { path: "/account/settings", element: mobileRouteElements.settings },
    { path: "/settings", element: <Navigate to="/account/settings" replace /> },
    { path: "/diagnostics", element: mobileRouteElements.diagnostics },
    { path: "/activity", element: <Navigate to="/files" replace /> },
    { path: "*", element: <Navigate to="/files" replace /> },
  ]);

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
    root.dataset.mistyTheme = "misty-dark";
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
  }, [providerLoad, routeId]);

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
      if (!hasTauriInternals()) return;
      void getCurrentWindow().setBadgeCount(badgeCount).catch(() => {});
    } catch {
      // Browser smoke mode and some platforms do not expose app badges.
    }
  }, [notificationPreferences.badgeCountEnabled, unreadActivityCount]);

  const filesRoute = routeId === "files";

  return (
    <main className={`${mobileShellBaseClass} ${filesRoute ? mobileShellFilesRowsClass : mobileShellRowsClass}`}>
      {!filesRoute ? (
        <header className={mobileTopbarClass}>
          <div className="grid min-w-0 gap-0.5">
            <span className="text-[11px] font-bold uppercase tracking-normal text-[#8792a0]">Misty</span>
            <strong className="truncate text-[22px] font-extrabold leading-[1.1] text-[#f4f0e8]">{title}</strong>
          </div>
          <button
            type="button"
            className={mobileIconButtonClass}
            aria-label="Activity"
            onClick={() => setActivityOpen(true)}
          >
            <Bell size={21} strokeWidth={1.9} />
            {unreadActivityCount > 0 ? <span className={mobileBadgeClass}>{formatBadgeCount(unreadActivityCount)}</span> : null}
          </button>
        </header>
      ) : null}

      <section className={mobileRouteShellClass}>
        {routeElement}
      </section>

      <nav className={`${mobileTabbarClass} ${filesRoute ? "bg-[#1b1c1f]" : "bg-[rgba(7,10,14,0.96)]"}`} aria-label="Primary">
        {mobileNavRoutes.filter((item) => item.nav).map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.id}
              to={item.path}
              className={({ isActive }) => {
                const active = item.id === "account"
                  ? location.pathname.startsWith("/account")
                  : isActive;
                return active ? `${mobileTabClass} ${mobileTabActiveClass}` : mobileTabClass;
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
  if (pathname.startsWith("/transfers")) return "/files";
  if (pathname.startsWith("/providers")) return "/providers";
  if (pathname.startsWith("/home")) return "/files";
  if (pathname.startsWith("/account/settings")) return "/account/settings";
  if (pathname.startsWith("/account")) return "/account";
  if (pathname.startsWith("/settings")) return "/account/settings";
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
    <div
      className="fixed inset-0 z-[1000] flex items-end bg-black/60"
      role="presentation"
      onClick={props.onClose}
    >
      <section
        className="max-h-[min(calc(100dvh-var(--misty-safe-top)-18px),680px)] w-full overflow-auto rounded-t-[18px] border border-white/10 bg-[#0a0f15] px-[max(var(--misty-mobile-edge),var(--misty-safe-right))] pb-[calc(14px+var(--misty-safe-bottom))] pt-4 shadow-[0_-24px_70px_rgba(0,0,0,0.52)]"
        aria-label="Activity"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="mb-3.5 flex items-center justify-between gap-3">
          <div>
            <span className="text-[11px] font-[760] uppercase tracking-normal text-[var(--misty-text-subtle)]">Inbox</span>
            <h2 className="m-0 text-xl leading-[1.15] text-[var(--misty-text)]">Activity</h2>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="min-h-[34px] rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-2.5 text-[var(--misty-text)] disabled:opacity-55"
              onClick={clearHistory}
              disabled={entries.length === 0}
            >
              Clear
            </button>
            <button
              type="button"
              className="min-h-[34px] rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-2.5 text-[var(--misty-text)]"
              onClick={props.onClose}
            >
              Done
            </button>
          </div>
        </header>
        {entries.length > 0 ? (
          <div className="grid gap-2">
            {entries.map((entry) => <MobileActivityEntry key={entry.id} entry={entry} />)}
          </div>
        ) : (
          <div className="grid min-h-[220px] place-items-center gap-1.5 text-center text-[#a3adba]">
            <h3 className="m-0 text-lg text-[var(--misty-text)]">No activity yet</h3>
            <p className="m-0 max-w-60">Transfer updates and local notices will appear here.</p>
          </div>
        )}
      </section>
    </div>
  );
});

function MobileActivityEntry(props: { entry: ExplorerNotification }) {
  return (
    <article className="grid grid-cols-[10px_minmax(0,1fr)] gap-2.5 border-0 border-b border-[var(--misty-border-soft)] bg-transparent p-0 py-2.5">
      <span className={`mt-1.5 h-2 w-2 rounded-full ${props.entry.type === "error" ? "bg-[var(--misty-danger)]" : "bg-[var(--misty-accent)]"}`} />
      <div>
        <p className="m-0 text-[var(--misty-text)]">{props.entry.message}</p>
        <time className="text-[11px] text-[var(--misty-text-subtle)]">{formatActivityTime(props.entry.createdAtMs)}</time>
      </div>
    </article>
  );
}

function mobileTitle(pathname: string): string {
  if (pathname.startsWith("/providers")) return "Remotes";
  if (pathname.startsWith("/account/settings") || pathname.startsWith("/settings")) return "Settings";
  if (pathname.startsWith("/account")) return "Account";
  if (pathname.startsWith("/diagnostics")) return "Diagnostics";
  if (pathname !== "/" && !pathname.startsWith("/files")) return "Desktop only";
  return "Files";
}

function formatActivityTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatBadgeCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}
