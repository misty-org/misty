import { memo, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Bell, CheckCheck, type LucideIcon } from "lucide-react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useExplorerStore, type ExplorerNotification } from "../stores/useExplorerStore";
import { useProvidersStore } from "../stores/useProvidersStore";
import {
  selectNotificationPreferences,
  useSettingsStore,
} from "../stores/useSettingsStore";
import { useAppStore } from "../stores/useAppStore";
import { hasTauriInternals } from "../shared/tauri";
import type { AppTab } from "../routing/types";
import { useSpacesStore } from "../stores/useSpacesStore";
import { SpacesRealtimeBridge } from "../spaces/SpacesRealtimeBridge";
import type { SpaceInboxItem } from "../spaces/types";

export type MobileNavItem = {
  id: string;
  label: string;
  path: string;
  icon: LucideIcon;
  nav: boolean;
};

const mobileShellBaseClass = "isolate grid h-[100dvh] min-h-0 w-full min-w-0 overflow-hidden bg-[#05070a] text-[#f4f0e8]";
const mobileShellRowsClass = "grid-rows-[auto_minmax(0,1fr)_calc(var(--misty-mobile-tabbar-height)+var(--misty-safe-bottom))]";
const mobileShellFilesRowsClass = "grid-rows-[minmax(0,1fr)_calc(var(--misty-mobile-tabbar-height)+var(--misty-safe-bottom))]";
const mobileTopbarClass = "relative z-[60] flex min-w-0 items-center justify-between gap-3 border-b border-white/10 bg-[#05070a] px-[max(var(--misty-mobile-edge),var(--misty-safe-right))] pb-2.5 pl-[max(var(--misty-mobile-edge),var(--misty-safe-left))] pt-[calc(12px+var(--misty-safe-top))]";
const mobileIconButtonClass = "relative grid h-11 w-11 flex-none place-items-center rounded-xl border border-white/10 bg-[#101720] text-[#eef3fb] disabled:opacity-45";
const mobileBadgeClass = "absolute -right-1.5 -top-1.5 grid h-[19px] min-w-[19px] place-items-center rounded-full bg-[#e14856] px-1.5 text-[10px] font-extrabold leading-none text-white";
const mobileRouteShellClass = "relative z-50 min-h-0 min-w-0 overflow-hidden";
const mobileTabbarClass = "relative z-40 grid box-border h-[calc(var(--misty-mobile-tabbar-height)+var(--misty-safe-bottom))] w-full max-w-full min-w-0 grid-cols-[repeat(auto-fit,minmax(50px,1fr))] gap-1 overflow-hidden border-t border-white/10 px-[max(8px,var(--misty-safe-right))] pb-[calc(8px+var(--misty-safe-bottom))] pl-[max(8px,var(--misty-safe-left))] pr-[max(8px,var(--misty-safe-right))] pt-[7px]";
const mobileTabClass = "grid h-full min-w-0 place-items-center gap-[3px] rounded-none text-[10px] font-bold text-[#a3adba] no-underline";
const mobileTabActiveClass = "bg-transparent text-[#f7f3ec]";

export function MobileLayout(props: {
  getRouteId: (pathname: string) => AppTab;
  lastRouteStorageKey: string;
  navItems: MobileNavItem[];
  normalizeRoute: (pathname: string) => string;
  safeRoute: (pathname: string) => string;
  titleForPath: (pathname: string) => string;
}) {
  const location = useLocation();
  const loadApp = useAppStore((state) => state.loadApp);
  const settingsLoad = useSettingsStore((state) => state.load);
  const providerLoad = useProvidersStore((state) => state.load);
  const notificationPreferences = useSettingsStore(useShallow((state) =>
    selectNotificationPreferences(state.settings?.document),
  ));
  const localUnreadActivityCount = useExplorerStore((state) => state.notificationHistory.filter((notification) => !notification.read).length);
  const cloudUnreadActivityCount = useSpacesStore((state) => [...state.inbox.unreads, ...state.inbox.mentions].filter((item) => !item.seen_at).length);
  const unreadActivityCount = localUnreadActivityCount + cloudUnreadActivityCount;
  const [activityOpen, setActivityOpen] = useState(false);
  const appLoadStarted = useRef(false);
  const routeId = props.getRouteId(location.pathname);
  const title = props.titleForPath(location.pathname);

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
    const normalized = props.safeRoute(props.normalizeRoute(location.pathname));
    try {
      window.localStorage.setItem(props.lastRouteStorageKey, normalized);
    } catch {
      // Mobile route memory is a convenience only.
    }
  }, [location.pathname, props]);

  useEffect(() => {
    const badgeCount = notificationPreferences.deviceNotificationsEnabled && notificationPreferences.badgeCountEnabled && unreadActivityCount > 0
      ? unreadActivityCount
      : undefined;
    try {
      if (!hasTauriInternals()) return;
      void getCurrentWindow().setBadgeCount(badgeCount).catch(() => undefined);
    } catch {}
  }, [notificationPreferences.badgeCountEnabled, notificationPreferences.deviceNotificationsEnabled, unreadActivityCount]);

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
        <Outlet />
      </section>

      <nav className={`${mobileTabbarClass} ${filesRoute ? "bg-[#1b1c1f]" : "bg-[rgba(7,10,14,0.96)]"}`} aria-label="Primary">
        {props.navItems.filter((item) => item.nav).map((item) => {
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
      <SpacesRealtimeBridge />
    </main>
  );
}

const MobileActivitySheet = memo(function MobileActivitySheet(props: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"unreads" | "mentions">("unreads");
  const { history, clearHistory, markRead } = useExplorerStore(useShallow((state) => ({
    history: state.notificationHistory,
    clearHistory: state.clearNotificationHistory,
    markRead: state.markNotificationsRead,
  })));
  const { inbox, loadInbox, markInboxSeen, clearInbox } = useSpacesStore(useShallow((state) => ({
    inbox: state.inbox,
    loadInbox: state.loadInbox,
    markInboxSeen: state.markInboxSeen,
    clearInbox: state.clearInbox,
  })));
  const entries = tab === "unreads" ? [...history].reverse() : [];
  const cloudEntries = inbox[tab];

  useEffect(() => {
    if (!props.open) return;
    markRead();
    void markInboxSeen().then(loadInbox);
  }, [loadInbox, markInboxSeen, markRead, props.open]);

  if (!props.open) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-end bg-black/60"
      role="presentation"
      onClick={props.onClose}
    >
      <section
        className="max-h-[min(calc(100dvh-var(--misty-safe-top)-18px),680px)] w-full overflow-auto rounded-t-[18px] border border-white/10 bg-[#0a0f15] pb-[calc(14px+var(--misty-safe-bottom))] pl-[max(var(--misty-mobile-edge),var(--misty-safe-left))] pr-[max(var(--misty-mobile-edge),var(--misty-safe-right))] pt-4 shadow-[0_-24px_70px_rgba(0,0,0,0.52)]"
        aria-label="Activity"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="mb-3.5 flex items-center justify-between gap-3">
          <h2 className="m-0 text-xl leading-[1.15] text-[var(--misty-text)]">Activity</h2>
          <div className="flex gap-2">
            <button
              type="button"
              className="grid size-11 place-items-center rounded-xl border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] p-0 text-[var(--misty-text)] disabled:opacity-55"
              onClick={() => { if (tab === "unreads") clearHistory(); void clearInbox(tab); }}
              disabled={entries.length + cloudEntries.length === 0}
              aria-label="Clear all activity"
              title="Clear all activity"
            >
              <CheckCheck size={21} strokeWidth={2} />
            </button>
            <button
              type="button"
              className="min-h-11 rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-2.5 text-[var(--misty-text)]"
              onClick={props.onClose}
            >
              Done
            </button>
          </div>
        </header>
        <div className="mb-3 grid grid-cols-2 border-b border-[var(--misty-border-soft)]">
          {(["unreads", "mentions"] as const).map((item) => <button className={`relative h-10 border-0 bg-transparent text-xs font-semibold capitalize ${tab === item ? "text-white after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-violet-400" : "text-[#8792a0]"}`} type="button" key={item} onClick={() => setTab(item)}>{item}{inbox[item].length ? <span className="ml-1.5 rounded-full bg-white/10 px-1.5 py-0.5 text-[9px]">{formatBadgeCount(inbox[item].length)}</span> : null}</button>)}
        </div>
        {entries.length + cloudEntries.length > 0 ? (
          <div className="grid gap-2">
            {cloudEntries.map((entry) => <MobileCloudActivityEntry key={entry.id} entry={entry} onOpen={() => { navigate(`/spaces/${encodeURIComponent(entry.space_id)}/chat${entry.message_id ? `?message=${encodeURIComponent(entry.message_id)}` : ""}`); props.onClose(); }} />)}
            {entries.map((entry) => <MobileActivityEntry key={entry.id} entry={entry} />)}
          </div>
        ) : (
          <div className="grid min-h-[220px] place-items-center gap-1.5 text-center text-[#a3adba]">
            <h3 className="m-0 text-lg text-[var(--misty-text)]">{tab === "mentions" ? "No mentions" : "You’re all caught up"}</h3>
            <p className="m-0 max-w-60">{tab === "mentions" ? "Mentions and Agent replies will appear here." : "Space messages and local notices will appear here."}</p>
          </div>
        )}
      </section>
    </div>
  );
});

function MobileCloudActivityEntry(props: { entry: SpaceInboxItem; onOpen: () => void }) {
  const preview = typeof props.entry.payload.preview === "string" ? props.entry.payload.preview : "";
  return <button className="border-0 border-b border-[var(--misty-border-soft)] bg-transparent py-2.5 text-left" type="button" onClick={props.onOpen}><small className="block text-[10px] font-semibold text-violet-300">{props.entry.space_name}</small><span className="block text-sm text-[var(--misty-text)]">{preview || (props.entry.kind === "mention" ? "You were mentioned" : "New activity")}</span><time className="text-[11px] text-[var(--misty-text-subtle)]">{formatActivityTime(new Date(props.entry.created_at).getTime())}</time></button>;
}

function MobileActivityEntry(props: { entry: ExplorerNotification }) {
  return (
    <article className="border-0 border-b border-[var(--misty-border-soft)] bg-transparent p-0 py-2.5">
      <div>
        <p className="m-0 text-[var(--misty-text)]">{props.entry.message}</p>
        <time className="text-[11px] text-[var(--misty-text-subtle)]">{formatActivityTime(props.entry.createdAtMs)}</time>
      </div>
    </article>
  );
}

function formatActivityTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatBadgeCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}
