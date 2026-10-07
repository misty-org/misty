import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  createPath,
  NavigationType,
  parsePath,
  resolvePath,
  UNSAFE_LocationContext,
  UNSAFE_NavigationContext,
  UNSAFE_RouteContext,
  useNavigate,
  type NavigateOptions,
  type Navigator,
  type To,
} from "react-router-dom";
import { workspaceSurfaceFromRoute } from "./routeSurface";
import { dockLeaves } from "./dockTree";
import type { WorkspaceView } from "./model";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { useStableCallback } from "@/shared/hooks/useStableCallback";

interface WorkspaceViewRouteHistory {
  entries: string[];
  index: number;
}

const routeHistories = new Map<string, WorkspaceViewRouteHistory>();
const WorkspaceViewIdContext = createContext<string | null>(null);

export function useWorkspaceViewFocused(): boolean {
  const tabId = useContext(WorkspaceViewIdContext);
  return useWorkspaceStore((state) => {
    if (!tabId) return true;
    const pane = dockLeaves(state.layout.root).find(
      (candidate) => candidate.id === state.layout.focusedPaneId,
    );
    return pane?.activeViewId === tabId;
  });
}

export function syncWorkspaceViewRouteHistory(tabId: string, route: string): void {
  const current = routeHistories.get(tabId);
  if (!current) {
    routeHistories.set(tabId, { entries: [route], index: 0 });
    return;
  }
  if (current.entries[current.index] === route) return;
  const existingIndex = current.entries.lastIndexOf(route);
  if (existingIndex >= 0) {
    current.index = existingIndex;
    return;
  }
  current.entries = [...current.entries.slice(0, current.index + 1), route];
  current.index = current.entries.length - 1;
}

export function navigateWorkspaceViewRoute(tabId: string, delta: number): string | null {
  const history = routeHistories.get(tabId);
  if (!history) return null;
  const nextIndex = history.index + delta;
  if (nextIndex < 0 || nextIndex >= history.entries.length) return null;
  history.index = nextIndex;
  return history.entries[nextIndex] ?? null;
}

export function releaseWorkspaceViewRouteHistory(tabId: string): void {
  routeHistories.delete(tabId);
}

function recordWorkspaceViewRoute(tabId: string, route: string, replace: boolean): void {
  const history = routeHistories.get(tabId) ?? { entries: [route], index: 0 };
  if (replace) {
    history.entries[history.index] = route;
  } else if (history.entries[history.index] !== route) {
    history.entries = [...history.entries.slice(0, history.index + 1), route];
    history.index = history.entries.length - 1;
  }
  routeHistories.set(tabId, history);
}

/**
 * Gives a mounted workspace tab its own React Router location.
 *
 * Nested apps can continue using `useLocation`, `useSearchParams`, links, and
 * `useNavigate`, but those APIs now read and update this tab's route. Only the
 * focused tab mirrors its route to the desktop address bar.
 */
export function WorkspaceViewRouteScope(props: { tab: WorkspaceView; children: ReactNode }) {
  // React Router replaces `navigate` on every app route change. Read it
  // through a stable callback so this tab's navigator, and every link and
  // navigate hook in the tab, stays the same while other tabs navigate.
  const navigateOuter = useNavigate();
  const outerNavigate = useStableCallback((to: To, options?: NavigateOptions) =>
    navigateOuter(to, options),
  );
  const route = props.tab.route || "/";
  const [routeState, setRouteState] = useState<{
    tabId: string;
    route: string;
    value: unknown;
  } | null>(null);
  useEffect(() => syncWorkspaceViewRouteHistory(props.tab.id, route), [props.tab.id, route]);
  const location = useMemo(() => {
    const parsed = parsePath(route);
    return {
      pathname: parsed.pathname || "/",
      search: parsed.search || "",
      hash: parsed.hash || "",
      state:
        routeState?.tabId === props.tab.id && routeState.route === route ? routeState.value : null,
      key: props.tab.id,
    };
  }, [props.tab.id, route, routeState]);

  const navigator = useMemo<Navigator>(() => {
    const apply = (
      nextRoute: string,
      state: unknown,
      options: NavigateOptions | undefined,
      record: boolean,
    ) => {
      const workspace = useWorkspaceStore.getState();
      if (record) recordWorkspaceViewRoute(props.tab.id, nextRoute, Boolean(options?.replace));
      setRouteState({ tabId: props.tab.id, route: nextRoute, value: state });
      workspace.updateViewRoute(props.tab.id, nextRoute, Boolean(options?.replace));
      const focusedPane = dockLeaves(workspace.layout.root).find(
        (pane) => pane.id === workspace.layout.focusedPaneId,
      );
      if (focusedPane?.activeViewId === props.tab.id) {
        // The pane owns its route stack. The address bar mirrors the focused
        // entry without duplicating that stack in the shell's browser history.
        outerNavigate(nextRoute, { ...options, state, replace: true });
      }
    };
    const commit = (to: To, state: unknown, options: NavigateOptions | undefined) => {
      const resolved = resolvePath(to, location.pathname);
      const nextRoute = createPath(resolved);
      const destination = workspaceSurfaceFromRoute(nextRoute);
      const sameDestination =
        destination &&
        destination.surfaceId === props.tab.surfaceId &&
        (destination.surfaceId === "space"
          ? destination.groupKey.split(":")[1] === props.tab.groupKey.split(":")[1]
          : destination.groupKey === props.tab.groupKey);
      if (destination && !sameDestination) {
        const opened = useWorkspaceStore.getState().openSurface(destination);
        outerNavigate(opened.route, { ...options, state, replace: true });
        return;
      }
      apply(nextRoute, state, options, true);
    };
    return {
      createHref: (to) => createPath(resolvePath(to, location.pathname)),
      encodeLocation: (to) => resolvePath(to, location.pathname),
      go: (delta) => {
        const workspace = useWorkspaceStore.getState();
        const pane = dockLeaves(workspace.layout.root).find(
          (pane) => pane.activeViewId === props.tab.id,
        );
        if (pane) {
          const view = workspace.navigatePane(delta, pane.id);
          if (view && pane.id === workspace.layout.focusedPaneId)
            outerNavigate(view.route, { replace: true });
          return;
        }
        const nextRoute = navigateWorkspaceViewRoute(props.tab.id, delta);
        if (nextRoute) apply(nextRoute, null, { replace: true }, false);
      },
      push: (to, state, options) => commit(to, state, options),
      replace: (to, state, options) => commit(to, state, { ...options, replace: true }),
    };
  }, [location.pathname, outerNavigate, props.tab.id, props.tab.groupKey, props.tab.surfaceId]);

  const navigationContext = useMemo(
    () => ({ basename: "/", navigator, static: false, useTransitions: false, future: {} }),
    [navigator],
  );
  const locationContext = useMemo(
    () => ({ location, navigationType: NavigationType.Pop }),
    [location],
  );
  const routeContext = useMemo(() => ({ outlet: null, matches: [], isDataRoute: false }), []);

  return (
    <WorkspaceViewIdContext.Provider value={props.tab.id}>
      <UNSAFE_NavigationContext.Provider value={navigationContext}>
        <UNSAFE_LocationContext.Provider value={locationContext}>
          <UNSAFE_RouteContext.Provider value={routeContext}>
            {props.children}
          </UNSAFE_RouteContext.Provider>
        </UNSAFE_LocationContext.Provider>
      </UNSAFE_NavigationContext.Provider>
    </WorkspaceViewIdContext.Provider>
  );
}
