import type { AppTab } from "@/features/app-shell";
import { isRememberableAppRoute, useAppRouteMemoryStore, useAppStore } from "@/features/app-shell";
import { preloadDesktopFilesPage, useExplorerStore } from "@/features/file-explorer";
import { useMediaSearchStore, useSearchStore } from "@/features/file-search";
import { useGlobalSearchStore } from "@/features/global-search";
import { useProvidersStore } from "@/features/providers";
import { selectSearchMaintenancePreferences, useSettingsStore } from "@/features/settings";
import { useTransfersStore } from "@/features/transfers";
import { useMultiPanelStore } from "@/features/workspace";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { settingsFallbackRoute } from "./helpers";

export function useDesktopBootstrap(params: { getRouteId: (pathname: string) => AppTab }) {
  const location = useLocation();
  const navigate = useNavigate();
  const app = useAppStore((state) => state.app);
  const loadApp = useAppStore((state) => state.loadApp);
  const providerLoad = useProvidersStore((state) => state.load);
  const transferLoad = useTransfersStore((state) => state.load);
  const settings = useSettingsStore((state) => state.settings);
  const settingsLoad = useSettingsStore((state) => state.load);
  const searchMaintenancePreferences = useSettingsStore(
    useShallow((state) => selectSearchMaintenancePreferences(state.settings?.document)),
  );
  const activePaneId = useMultiPanelStore((state) => state.activePaneId);
  const activePanePath = useExplorerStore(
    (state) => state.panes[activePaneId]?.listing?.path ?? "",
  );
  const rememberAppRoute = useAppRouteMemoryStore((state) => state.rememberAppRoute);
  const lastAppRoute = useAppRouteMemoryStore((state) => state.lastAppRoute);

  const appLoadStarted = useRef(false);
  const searchMaintenanceRunningRef = useRef(false);
  const loadedRoutes = useRef(new Set<AppTab>());
  const lastNonSettingsRouteRef = useRef(settingsFallbackRoute("/spaces", lastAppRoute));
  const routeId = params.getRouteId(location.pathname);

  useEffect(() => {
    if (appLoadStarted.current) return;
    appLoadStarted.current = true;
    void preloadDesktopFilesPage()?.catch(() => undefined);
    if (!hasTauriInternals()) return;
    void loadApp();
    void settingsLoad();
  }, [loadApp, settingsLoad]);

  useEffect(() => {
    if (!app || !hasTauriInternals()) return;
    // Loading the durable media queue at app startup resumes explicitly
    // approved work without requiring the user to revisit the Library page.
    void useMediaSearchStore.getState().load();
  }, [app]);

  useEffect(() => {
    if (!settings || !hasTauriInternals()) return;
    const intervalMs = searchMaintenancePreferences.discoveryIntervalMinutes * 60_000;
    let disposed = false;

    const maintainSearch = async () => {
      if (disposed || searchMaintenanceRunningRef.current) return;
      searchMaintenanceRunningRef.current = true;
      try {
        if (searchMaintenancePreferences.automaticFileDiscoveryEnabled) {
          const search = useSearchStore.getState();
          await search.initialize();
          const status = useSearchStore.getState().status;
          const stale = !status?.lastScanTimeMs || Date.now() - status.lastScanTimeMs >= intervalMs;
          if (!status?.scanInProgress && stale) {
            await useSearchStore.getState().startScan(app?.environment.homeDir || "");
          }
        }
      } finally {
        searchMaintenanceRunningRef.current = false;
      }
    };

    const initial = window.setTimeout(() => void maintainSearch(), 4_000);
    const timer = window.setInterval(() => void maintainSearch(), intervalMs);
    const resume = () => {
      if (document.visibilityState === "visible") void maintainSearch();
    };
    window.addEventListener("online", maintainSearch);
    document.addEventListener("visibilitychange", resume);
    return () => {
      disposed = true;
      window.clearTimeout(initial);
      window.clearInterval(timer);
      window.removeEventListener("online", maintainSearch);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [
    app?.environment.homeDir,
    searchMaintenancePreferences.automaticFileDiscoveryEnabled,
    searchMaintenancePreferences.discoveryIntervalMinutes,
    settings,
  ]);

  useEffect(() => {
    const onGlobalSearchShortcut = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.key.toLocaleLowerCase() !== "k"
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      useGlobalSearchStore.getState().activateLauncher();
      window.setTimeout(
        () =>
          document.querySelector<HTMLInputElement>("[data-global-misty-launcher-input]")?.focus(),
        0,
      );
    };
    window.addEventListener("keydown", onGlobalSearchShortcut, true);
    return () => window.removeEventListener("keydown", onGlobalSearchShortcut, true);
  }, []);

  useEffect(() => {
    const onGlobalRefreshShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLocaleLowerCase() !== "r") return;
      // Cmd+R is bound to "explorer.refresh", but that binding is only
      // intercepted while the Files page is mounted. Everywhere else (Spaces,
      // Settings, Agents, ...) nothing prevents the default, so the
      // webview does a real full-page reload: every bit of in-memory state is
      // lost and the whole bootstrap sequence in main.tsx reruns from
      // scratch, which is what causes the black-screen flash on refresh.
      // This only calls preventDefault(), not stopPropagation(), so
      // Explorer's own bubble-phase listener still runs its refresh command
      // normally when it's mounted.
      event.preventDefault();
    };
    window.addEventListener("keydown", onGlobalRefreshShortcut, true);
    return () => window.removeEventListener("keydown", onGlobalRefreshShortcut, true);
  }, []);

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
    const route = `${location.pathname}${location.search}`;
    if (location.pathname === "/account" || location.pathname.startsWith("/providers")) return;
    if (isRememberableAppRoute(route)) {
      rememberAppRoute(route);
    }
  }, [location.pathname, location.search, rememberAppRoute]);

  useEffect(() => {
    if (
      location.pathname.startsWith("/settings") ||
      location.pathname === "/account" ||
      location.pathname.startsWith("/providers")
    )
      return;
    lastNonSettingsRouteRef.current = `${location.pathname}${location.search}`;
  }, [location.pathname, location.search]);

  return {
    location,
    navigate,
    app,
    settingsLoad,
    activePaneId,
    activePanePath,
    lastAppRoute,
    lastNonSettingsRouteRef,
    routeId,
  };
}
