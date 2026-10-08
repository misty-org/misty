import type { AppTab } from "@/features/app-shell";
import { isRememberableAppRoute, useAppRouteMemoryStore, useAppStore } from "@/features/app-shell";
import { useSettingsStore } from "@/features/settings";
import { dockLeaves, useWorkspaceStore } from "@/features/workspace";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { settingsFallbackRoute } from "./helpers";

export function useDesktopBootstrap(params: { getRouteId: (pathname: string) => AppTab }) {
  const location = useLocation();
  const navigate = useNavigate();
  const app = useAppStore((state) => state.app);
  const loadApp = useAppStore((state) => state.loadApp);
  const settings = useSettingsStore((state) => state.settings);
  const settingsLoad = useSettingsStore((state) => state.load);
  const workspaceLayout = useWorkspaceStore((state) => state.layout);
  const activeWorkspacePane = useMemo(
    () =>
      dockLeaves(workspaceLayout.root).find((pane) => pane.id === workspaceLayout.focusedPaneId) ??
      dockLeaves(workspaceLayout.root)[0],
    [workspaceLayout],
  );
  const rememberAppRoute = useAppRouteMemoryStore((state) => state.rememberAppRoute);
  const lastAppRoute = useAppRouteMemoryStore((state) => state.lastAppRoute);

  const appLoadStarted = useRef(false);
  const loadedRoutes = useRef(new Set<AppTab>());
  const lastNonSettingsRouteRef = useRef(settingsFallbackRoute("/browser", lastAppRoute));
  const routeId = params.getRouteId(location.pathname);

  useEffect(() => {
    if (appLoadStarted.current) return;
    appLoadStarted.current = true;
    if (!hasTauriInternals()) return;
    void loadApp();
    void settingsLoad();
  }, [loadApp, settingsLoad]);

  useEffect(() => {
    if (loadedRoutes.current.has(routeId)) return;
    loadedRoutes.current.add(routeId);
    if (!hasTauriInternals()) return;
    if (routeId === "settings" && !settings) void settingsLoad();
  }, [routeId, settings, settingsLoad]);

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
    activePaneId: "",
    activeWorkspacePaneId: activeWorkspacePane?.id ?? "",
    lastAppRoute,
    lastNonSettingsRouteRef,
    routeId,
  };
}
