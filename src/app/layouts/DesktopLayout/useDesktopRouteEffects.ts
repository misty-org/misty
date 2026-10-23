import { routes } from "@/features/app-shell";
import { isSetupCompletedForAccount, useSetupStore } from "@/features/setup";
import {
  activeLayoutView,
  allLayoutViews,
  useWorkspaceStore,
  workspaceSurfaceFromRoute,
} from "@/features/workspace";
import { useEffect, type MutableRefObject } from "react";
import type { Location, NavigateFunction } from "react-router-dom";
import { settingsFallbackRoute } from "./helpers";

/** Route-driven side effects: first-run setup, settings redirects and workspace sync. */
export function useDesktopRouteEffects(options: {
  userId: string | undefined;
  transitioning: boolean;
  location: Location;
  navigate: NavigateFunction;
  lastAppRoute: string;
  lastNonSettingsRouteRef: MutableRefObject<string>;
  openSettingsOverlay: () => void;
}) {
  const {
    userId,
    transitioning,
    location,
    navigate,
    lastAppRoute,
    lastNonSettingsRouteRef,
    openSettingsOverlay,
  } = options;
  const openWorkspaceSurface = useWorkspaceStore((state) => state.openSurface);

  useEffect(() => {
    if (!userId || transitioning) return;
    const setup = useSetupStore.getState();
    if (!isSetupCompletedForAccount(setup, userId) && !setup.isOpen) setup.startSetup();
  }, [userId, transitioning]);

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
