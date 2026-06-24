import { memo, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { ArrowRightLeft, Bell, Blocks, Folder, PanelsTopLeft, Puzzle, Settings as SettingsIcon } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import mistyLogo from "../assets/misty.png";
import { DiagnosticsWorkspace } from "../features/diagnostics/desktop/DiagnosticsWorkspace";
import { DockWorkspace } from "../features/dock/desktop/DockWorkspace";
import { ExplorerWorkspace } from "../features/explorer/desktop/ExplorerWorkspace";
import { useExplorerStore } from "../features/explorer/state/useExplorerStore";
import type { ExplorerNotification, ExplorerNotificationType } from "../features/explorer/state/useExplorerStore";
import { HubWorkspace } from "../features/hub/desktop/HubWorkspace";
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
import { ProvidersWorkspace } from "../features/providers/desktop/ProvidersWorkspace";
import { useProvidersStore } from "../features/providers/useProvidersStore";
import { SettingsWorkspace } from "../features/settings/desktop/SettingsWorkspace";
import {
  selectAppearancePreferences,
  selectCustomFontPreferences,
  selectGeneralPreferences,
  selectNotificationPreferences,
  settingsBoolean,
  useSettingsStore,
} from "../features/settings/useSettingsStore";
import { TransfersWorkspace } from "../features/transfers/desktop/TransfersWorkspace";
import { useTransfersStore } from "../features/transfers/useTransfersStore";
import {
  isRememberableAppRoute,
  useAppRouteMemoryStore,
} from "./useAppRouteMemoryStore";
import { useAppStore } from "./useAppStore";
import { useAppThemeStore } from "./useAppThemeStore";
import type { AppTab } from "./types";

const primaryNavItems = [
  { id: "files", label: "Files", path: "/files", icon: Folder },
  { id: "transfers", label: "Transfers", path: "/transfers", icon: ArrowRightLeft },
  { id: "providers", label: "Providers", path: "/providers", icon: PanelsTopLeft },
  { id: "dock", label: "Plugins", path: "/dock", icon: Puzzle },
  { id: "hub", label: "Hub", path: "/hub", icon: Blocks },
] satisfies Array<{ id: AppTab; label: string; path: string; icon: typeof Folder }>;

const bottomNavItems = [
  { id: "activity", label: "Activity", path: "/activity", icon: Bell },
  { id: "settings", label: "Settings", path: "/settings", icon: SettingsIcon },
] satisfies Array<{ id: AppTab; label: string; path: string; icon: typeof Folder }>;

const DEFAULT_FONT_STACK = `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;

export function DesktopAppShell() {
  const location = useLocation();
  const { app, loadApp } = useAppStore(useShallow((state) => ({
    app: state.app,
    loadApp: state.loadApp,
  })));
  const providerLoad = useProvidersStore((state) => state.load);
  const transferLoad = useTransfersStore((state) => state.load);
  const { settings, settingsLoad } = useSettingsStore(useShallow((state) => ({
    settings: state.settings,
    settingsLoad: state.load,
  })));
  const unreadActivityCount = useExplorerStore((state) => state.notificationHistory.filter((notification) => !notification.read).length);
  const { resolvedTheme, setSystemTheme, themeMode } = useAppThemeStore(useShallow((state) => ({
    resolvedTheme: state.resolvedTheme,
    setSystemTheme: state.setSystemTheme,
    themeMode: state.themeMode,
  })));
  const appearancePreferences = useSettingsStore(useShallow((state) =>
    selectAppearancePreferences(state.settings?.document),
  ));
  const customFontSignature = useSettingsStore((state) =>
    JSON.stringify(selectCustomFontPreferences(state.settings?.document)),
  );
  const notificationPreferences = useSettingsStore(useShallow((state) =>
    selectNotificationPreferences(state.settings?.document),
  ));
  const framePacingOverlayEnabled = useSettingsStore((state) =>
    settingsBoolean(state.settings?.document ?? {}, "advanced", "frame_pacing_overlay_enabled", false),
  );
  const lastHubRoute = useHubRouteMemoryStore((state) => state.lastHubRoute);
  const rememberHubRoute = useHubRouteMemoryStore((state) => state.rememberHubRoute);
  const rememberAppRoute = useAppRouteMemoryStore((state) => state.rememberAppRoute);
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
    void settingsLoad();
  }, [loadApp, settingsLoad]);

  useEffect(() => {
    if (loadedRoutes.current.has(routeId)) return;
    loadedRoutes.current.add(routeId);
    if (routeId === "files" || routeId === "providers" || routeId === "diagnostics") {
      void providerLoad(routeId === "providers");
    }
    if (routeId === "transfers") void transferLoad("");
    if (routeId === "settings" && !settings) void settingsLoad();
  }, [providerLoad, routeId, settings, settingsLoad, transferLoad]);

  useEffect(() => {
    if (isRememberableHubRoute(location.pathname)) {
      rememberHubRoute(location.pathname);
    }
  }, [location.pathname, rememberHubRoute]);

  useEffect(() => {
    const route = `${location.pathname}${location.search}`;
    if (isRememberableAppRoute(route)) {
      rememberAppRoute(route);
    }
  }, [location.pathname, location.search, rememberAppRoute]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    root.dataset.themeMode = themeMode;
    root.dataset.compactMode = String(appearancePreferences.compactModeEnabled);
    root.dataset.fontSize = appearancePreferences.fontSize;
    root.dataset.reducedMotion = String(appearancePreferences.reducedMotionEnabled);
    root.dataset.thumbnailPreviews = String(appearancePreferences.thumbnailPreviewsEnabled);
    root.dataset.uiScale = appearancePreferences.uiScale;
    root.style.colorScheme = resolvedTheme;
  }, [appearancePreferences, resolvedTheme, themeMode]);

  useEffect(() => {
    const badgeCount = notificationPreferences.badgeCountEnabled && unreadActivityCount > 0
      ? unreadActivityCount
      : undefined;
    try {
      void getCurrentWindow().setBadgeCount(badgeCount).catch(() => {
        // Some platforms or browser test contexts do not support app badge counts.
      });
    } catch {
      // Some platforms or browser test contexts do not support app badge counts.
    }
  }, [notificationPreferences.badgeCountEnabled, unreadActivityCount]);

  useEffect(() => {
    const customFonts = parseCustomFontSignature(customFontSignature);
    const styleId = "misty-custom-fonts";
    const existing = document.getElementById(styleId);
    existing?.remove();

    if (customFonts.length === 0) {
      document.documentElement.style.setProperty("--misty-font-family", DEFAULT_FONT_STACK);
      return;
    }

    const rules = customFonts
      .map((font, index) => {
        const family = customFontFamilyName(index);
        return `@font-face{font-family:${cssString(family)};src:url(${cssUrl(convertFileSrc(font.path))});font-display:swap;}`;
      })
      .join("\n");
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = rules;
    document.head.appendChild(style);

    const customStack = customFonts.map((_, index) => cssString(customFontFamilyName(index))).join(", ");
    document.documentElement.style.setProperty("--misty-font-family", `${customStack}, ${DEFAULT_FONT_STACK}`);

    return () => {
      style.remove();
    };
  }, [customFontSignature]);

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
          <NavGroup
            currentPath={location.pathname}
            items={bottomNavItems}
            badges={{ activity: notificationPreferences.badgeCountEnabled ? unreadActivityCount : 0 }}
          />
        </div>
      </nav>

      <section className="route-shell">
        <AppNoticePublisher />
        <RouteNotice routeId={routeId} />

        <Routes>
          <Route path="/" element={<StartupRedirect />} />
          <Route path="/files" element={<ExplorerWorkspace />} />
          <Route path="/providers" element={<ProvidersWorkspace />} />
          <Route path="/transfers" element={<TransfersWorkspace />} />
          <Route path="/dock" element={<DockWorkspace />} />
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

      <FramePacingOverlay enabled={framePacingOverlayEnabled} />
    </main>
  );
}

function parseCustomFontSignature(signature: string): Array<{ label: string; path: string }> {
  try {
    const value = JSON.parse(signature) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is { label: string; path: string } =>
      !!entry &&
      typeof entry === "object" &&
      typeof (entry as Record<string, unknown>).label === "string" &&
      typeof (entry as Record<string, unknown>).path === "string",
    );
  } catch {
    return [];
  }
}

function customFontFamilyName(index: number): string {
  return `Misty Custom Font ${index + 1}`;
}

function cssString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function cssUrl(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
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
  const notificationPreferences = useSettingsStore(useShallow((state) =>
    selectNotificationPreferences(state.settings?.document),
  ));
  const notice = noticeForRoute(props.routeId, {
    app: { error: appError, message: appMessage },
    providers: { error: providerError, message: providerMessage },
    transfers: { error: transferError, message: transferMessage },
    settings: { error: settingsError, message: settingsMessage },
  });
  const showMessage = notificationPreferences.inAppNotificationsEnabled
    && !notificationPreferences.quietHoursEnabled;

  return (
    <>
      {notice.error ? <div className="error global-banner">{notice.error}</div> : null}
      {showMessage && notice.message ? <div className="message global-banner">{notice.message}</div> : null}
    </>
  );
});

type AppNoticeSource = "app" | "providers" | "transfers" | "settings";
type AppNoticeKind = "error" | "message";
type AppNoticeEntry = readonly [AppNoticeSource, AppNoticeKind, string | null];

const AppNoticePublisher = memo(function AppNoticePublisher() {
  const appError = useAppStore((state) => state.error);
  const appMessage = useAppStore((state) => state.message);
  const providerError = useProvidersStore((state) => state.error);
  const providerMessage = useProvidersStore((state) => state.message);
  const transferError = useTransfersStore((state) => state.error);
  const transferMessage = useTransfersStore((state) => state.message);
  const settingsError = useSettingsStore((state) => state.error);
  const settingsMessage = useSettingsStore((state) => state.message);
  const lastPublished = useRef<Record<string, string>>({});

  useEffect(() => {
    const entries = [
      ["app", "error", appError],
      ["app", "message", appMessage],
      ["providers", "error", providerError],
      ["providers", "message", providerMessage],
      ["transfers", "error", transferError],
      ["transfers", "message", transferMessage],
      ["settings", "error", settingsError],
      ["settings", "message", settingsMessage],
    ] satisfies AppNoticeEntry[];
    const pushNotification = useExplorerStore.getState().pushNotification;

    for (const [source, kind, value] of entries) {
      const key = `${source}:${kind}`;
      const message = value?.trim() ?? "";
      if (!message) {
        lastPublished.current[key] = "";
        continue;
      }

      const signature = `${kind}:${message}`;
      if (lastPublished.current[key] === signature) continue;
      lastPublished.current[key] = signature;
      pushNotification(
        `${appNoticeSourceLabel(source)}: ${message}`,
        appNoticeType(kind),
        kind === "error" ? 5500 : 3500,
        true,
      );
    }
  }, [
    appError,
    appMessage,
    providerError,
    providerMessage,
    transferError,
    transferMessage,
    settingsError,
    settingsMessage,
  ]);

  return null;
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

function StartupRedirect() {
  const { loaded, settings } = useSettingsStore(useShallow((state) => ({
    loaded: state.loaded,
    settings: state.settings,
  })));
  const lastAppRoute = useAppRouteMemoryStore((state) => state.lastAppRoute);

  if (!loaded) {
    return (
      <section className="placeholder-page" aria-label="Loading Misty">
        <div className="empty">Loading...</div>
      </section>
    );
  }

  const generalPreferences = selectGeneralPreferences(settings?.document);
  const target = generalPreferences.reopenLastSession && isRememberableAppRoute(lastAppRoute)
    ? lastAppRoute
    : startupRouteForIndex(generalPreferences.startupViewIndex);

  return <Navigate to={target} replace />;
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
  const confirmDestructiveActions = useSettingsStore((state) =>
    selectGeneralPreferences(state.settings?.document).confirmDestructiveActions,
  );
  const entries = [...history].reverse();
  const hasEntries = entries.length > 0;
  const clearActivityHistory = () => {
    if (
      confirmDestructiveActions
      && !window.confirm("Clear all Activity notifications on this device?")
    ) {
      return;
    }
    clearHistory();
  };

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
            <button type="button" onClick={clearActivityHistory} disabled={!hasEntries}>
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

type FramePacingState = {
  fps: number;
  frameMs: number;
  slowFramePercent: number;
  level: "idle" | "light" | "heavy";
};

function FramePacingOverlay(props: { enabled: boolean }) {
  const [state, setState] = useState<FramePacingState>({
    fps: 0,
    frameMs: 0,
    slowFramePercent: 0,
    level: "idle",
  });

  useEffect(() => {
    if (!props.enabled) return;

    let animationFrame = 0;
    let lastFrameAt = performance.now();
    let sampleStartedAt = lastFrameAt;
    let frameCount = 0;
    let slowFrameCount = 0;
    let totalFrameMs = 0;

    const tick = (now: number) => {
      const frameMs = now - lastFrameAt;
      lastFrameAt = now;

      if (frameCount > 0) {
        totalFrameMs += frameMs;
        if (frameMs > 34) slowFrameCount += 1;
      }
      frameCount += 1;

      const elapsedMs = now - sampleStartedAt;
      if (elapsedMs >= 600) {
        const measuredFrames = Math.max(1, frameCount - 1);
        const fps = Math.round((frameCount * 1000) / elapsedMs);
        const averageFrameMs = totalFrameMs / measuredFrames;
        const slowFramePercent = Math.round((slowFrameCount / measuredFrames) * 100);
        const level = fps < 45 || slowFramePercent > 25
          ? "heavy"
          : fps < 56 || slowFramePercent > 8
            ? "light"
            : "idle";

        setState((previous) => {
          if (
            previous.fps === fps
            && Math.abs(previous.frameMs - averageFrameMs) < 0.1
            && previous.slowFramePercent === slowFramePercent
            && previous.level === level
          ) {
            return previous;
          }
          return { fps, frameMs: averageFrameMs, slowFramePercent, level };
        });

        sampleStartedAt = now;
        frameCount = 0;
        slowFrameCount = 0;
        totalFrameMs = 0;
      }

      animationFrame = requestAnimationFrame(tick);
    };

    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [props.enabled]);

  if (!props.enabled) return null;

  const label = state.level === "idle" ? "Idle" : state.level === "light" ? "Light" : "Heavy";

  return (
    <aside className={`frame-pacing-overlay ${state.level}`} aria-label="Frame pacing overlay">
      <strong>{label}</strong>
      <span>{state.fps > 0 ? state.fps : "--"} FPS</span>
      <span>{state.frameMs > 0 ? state.frameMs.toFixed(1) : "--"} ms</span>
      <span>{state.slowFramePercent}% slow</span>
    </aside>
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
  if (pathname.startsWith("/dock")) return "dock";
  if (pathname.startsWith("/hub")) return "hub";
  if (pathname.startsWith("/activity")) return "activity";
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.startsWith("/diagnostics")) return "diagnostics";
  return "files";
}

function startupRouteForIndex(index: number): string {
  if (index === 1) return "/providers";
  if (index === 2) return "/activity";
  if (index === 3) return "/transfers";
  if (index === 4) return "/dock";
  if (index === 5) return "/hub";
  if (index === 6) return "/settings";
  return "/files";
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

function appNoticeSourceLabel(source: AppNoticeSource): string {
  switch (source) {
    case "providers":
      return "Providers";
    case "transfers":
      return "Transfers";
    case "settings":
      return "Settings";
    case "app":
      return "Misty";
  }
}

function appNoticeType(kind: AppNoticeKind): ExplorerNotificationType {
  return kind === "error" ? "error" : "success";
}
