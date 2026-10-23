import type { AppTab } from "@/features/app-shell";
import { isRememberableAppRoute, useAppRouteMemoryStore, useAppStore } from "@/features/app-shell";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { settingsFallbackRoute } from "./helpers";

export function useDesktopBootstrap(params: { getRouteId: (pathname: string) => AppTab }) {
  const location = useLocation();
  const navigate = useNavigate();
  const app = useAppStore((state) => state.app);
  const loadApp = useAppStore((state) => state.loadApp);
  const rememberAppRoute = useAppRouteMemoryStore((state) => state.rememberAppRoute);
  const lastAppRoute = useAppRouteMemoryStore((state) => state.lastAppRoute);

  const appLoadStarted = useRef(false);
  const lastNonSettingsRouteRef = useRef(settingsFallbackRoute("/browser", lastAppRoute));
  const routeId = params.getRouteId(location.pathname);

  useEffect(() => {
    if (appLoadStarted.current) return;
    appLoadStarted.current = true;
    if (!hasTauriInternals()) return;
    void loadApp();
  }, [loadApp]);

  useEffect(() => {
    const route = `${location.pathname}${location.search}`;
    if (location.pathname === "/account") return;
    if (isRememberableAppRoute(route)) {
      rememberAppRoute(route);
    }
  }, [location.pathname, location.search, rememberAppRoute]);

  useEffect(() => {
    if (location.pathname.startsWith("/settings") || location.pathname === "/account") return;
    lastNonSettingsRouteRef.current = `${location.pathname}${location.search}`;
  }, [location.pathname, location.search]);

  return {
    location,
    navigate,
    app,
    lastAppRoute,
    lastNonSettingsRouteRef,
    routeId,
  };
}
