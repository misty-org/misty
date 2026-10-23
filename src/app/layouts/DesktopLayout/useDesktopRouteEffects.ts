import { isAuthPath, routes } from "@/features/app-shell";
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

  // Setup follows the welcome on first run, for an account or for browsing without one.
  const onAuthPage = isAuthPath(location.pathname);
  useEffect(() => {
    if (transitioning || onAuthPage) return;
    const setup = useSetupStore.getState();
    // Signing in passes the welcome as Start browsing does.
    if (userId) setup.finishWelcome();
    if (!isSetupCompletedForAccount(setup, userId) && !setup.isOpen) setup.startSetup();
  }, [userId, transitioning, onAuthPage]);

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
