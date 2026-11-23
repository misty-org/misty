import { routes } from "@/app/shell";
import {
  activeLayoutView,
  allLayoutViews,
  isRetiredWebRoute,
  useWorkspaceStore,
  workspaceSurfaceFromRoute,
} from "@/features/app-windows";
import { useEffect, type MutableRefObject } from "react";
import type { Location, NavigateFunction } from "react-router-dom";
import { settingsFallbackRoute } from "./account_menu_text";

export function useDesktopRouteEffects(options: {
  location: Location;
  navigate: NavigateFunction;
  lastAppRoute: string;
  lastNonSettingsRouteRef: MutableRefObject<string>;
  openSettingsOverlay: () => void;
}) {
  const { location, navigate, lastAppRoute, lastNonSettingsRouteRef, openSettingsOverlay } =
    options;
  const openWorkspaceSurface = useWorkspaceStore((state) => state.openSurface);

  useEffect(() => {
    if (!location.pathname.startsWith("/settings")) return;
    openSettingsOverlay();
    navigate(settingsFallbackRoute(lastNonSettingsRouteRef.current, lastAppRoute), {
      replace: true,
    });
  }, [lastAppRoute, lastNonSettingsRouteRef, location.pathname, navigate, openSettingsOverlay]);

  useEffect(() => {
    const currentRoute = `${location.pathname}${location.search}${location.hash}`;
    if (currentRoute === routes.newTab || currentRoute.endsWith("/new")) {
      const state = useWorkspaceStore.getState();
      const views = allLayoutViews(state.layout);
      const existingPlaceholder = views.find((v) => v.placeholder);
      if (existingPlaceholder) {
        state.focusView(existingPlaceholder.id);
      }
      return;
    }
    if (isRetiredWebRoute(currentRoute)) {
      navigate(routes.agents, { replace: true });
      return;
    }
    const surface = workspaceSurfaceFromRoute(currentRoute);
    if (surface) {
      if (
        surface.route === currentRoute &&
        activeLayoutView(useWorkspaceStore.getState().layout)?.route === currentRoute
      )
        return;
      const view = openWorkspaceSurface(surface);
      if (view.route !== currentRoute) navigate(view.route, { replace: true });
    }
  }, [location.pathname, location.search, location.hash, navigate, openWorkspaceSurface]);

  useEffect(() => {
    if (location.pathname === "/") {
      const active = activeLayoutView(useWorkspaceStore.getState().layout);
      const target = active ? active.route : routes.newTab;
      navigate(target, { replace: true });
    }
  }, [location.pathname, navigate]);
}
