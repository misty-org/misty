import { useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  compareTabRecency,
  dockTabs,
  useWorkspaceStore,
  workspaceSurfaceFromRoute,
} from "@/features/workspace";
import { currentVirtualWindows } from "@/features/workspace/virtualWindows";

/** Resume an existing page instead of replacing its route with the app's default. */
export function useNavigatorResume(options: {
  accountId: string;
  key: string;
  fallbackRoute: string;
  activeRoute?: string;
  matchesRoute?: (route: string) => boolean;
}) {
  const navigate = useNavigate();
  const memory = useRef({ scope: "", route: "" });
  const currentScope = useWorkspaceStore((state) => state.activeScopeKey);
  const targetScope = workspaceSurfaceFromRoute(options.fallbackRoute)?.scopeKey ?? currentScope;
  const scope = JSON.stringify([options.accountId, targetScope, options.key]);
  if (memory.current.scope !== scope) memory.current = { scope, route: "" };
  if (options.activeRoute) memory.current.route = pageRoute(options.activeRoute);
  return () => {
    const route = memory.current.route || options.fallbackRoute;
    const surface = workspaceSurfaceFromRoute(route);
    if (!surface) return;
    if (surface.scopeKey) useWorkspaceStore.getState().setScope(surface.scopeKey);
    const state = useWorkspaceStore.getState();
    const tabs = [
      ...dockTabs(state.layout.root),
      ...currentVirtualWindows(state).flatMap((window) => dockTabs(window.layout.root)),
    ];
    // The active layout is authoritative while its saved window snapshot catches up.
    const seen = new Set<string>();
    const candidates = tabs
      .filter((tab) => {
        if (seen.has(tab.id)) return false;
        seen.add(tab.id);
        return true;
      })
      .filter(
        (tab) =>
          workspaceSurfaceFromRoute(tab.route)?.groupKey === surface.groupKey &&
          (!options.matchesRoute || options.matchesRoute(tab.route)),
      )
      .sort(compareTabRecency);
    const existing = memory.current.route
      ? candidates.find((tab) => pageRoute(tab.route) === memory.current.route)
      : candidates[0];
    if (existing && state.focusTab(existing.id)) {
      const destination = pageRoute(existing.route);
      if (destination !== existing.route) state.updateTabRoute(existing.id, destination);
      navigate(destination);
    } else {
      const tab = state.openSurface({ ...surface, syncExistingRoute: true });
      navigate(tab.route);
    }
  };
}

function pageRoute(route: string) {
  const url = new URL(route, "https://misty.local");
  url.searchParams.delete("drawer");
  url.searchParams.delete("manage");
  return `${url.pathname}${url.search}${url.hash}`;
}
