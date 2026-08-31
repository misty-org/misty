import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
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
import { dockLeaves } from "./dockTree";
import type { WorkspaceTab } from "./model";
import { useWorkspaceStore } from "./useWorkspaceStore";

interface WorkspaceTabRouteHistory {
  entries: string[];
  index: number;
}

const routeHistories = new Map<string, WorkspaceTabRouteHistory>();
const WorkspaceTabIdContext = createContext<string | null>(null);

export function useWorkspaceTabFocused(): boolean {
  const tabId = useContext(WorkspaceTabIdContext);
  return useWorkspaceStore((state) => {
    if (!tabId) return true;
    const pane = dockLeaves(state.layout.root).find(
      (candidate) => candidate.id === state.layout.focusedPaneId,
    );
    return pane?.activeTabId === tabId;
  });
}

export function syncWorkspaceTabRouteHistory(tabId: string, route: string): void {
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

export function canNavigateWorkspaceTabRoute(tabId: string, delta: number): boolean {
  const history = routeHistories.get(tabId);
  if (!history) return false;
  const nextIndex = history.index + delta;
  return nextIndex >= 0 && nextIndex < history.entries.length;
}

export function navigateWorkspaceTabRoute(tabId: string, delta: number): string | null {
  const history = routeHistories.get(tabId);
  if (!history) return null;
  const nextIndex = history.index + delta;
  if (nextIndex < 0 || nextIndex >= history.entries.length) return null;
  history.index = nextIndex;
  return history.entries[nextIndex] ?? null;
}

export function releaseWorkspaceTabRouteHistory(tabId: string): void {
  routeHistories.delete(tabId);
}

function recordWorkspaceTabRoute(tabId: string, route: string, replace: boolean): void {
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
export function WorkspaceTabRouteScope(props: { tab: WorkspaceTab; children: ReactNode }) {
  const outerNavigate = useNavigate();
  const route = props.tab.route || "/";
  useEffect(() => syncWorkspaceTabRouteHistory(props.tab.id, route), [props.tab.id, route]);
  const location = useMemo(() => {
    const parsed = parsePath(route);
    return {
      pathname: parsed.pathname || "/",
      search: parsed.search || "",
      hash: parsed.hash || "",
      state: null,
      key: props.tab.id,
    };
  }, [props.tab.id, route]);

  const navigator = useMemo<Navigator>(() => {
    const apply = (
      nextRoute: string,
      state: unknown,
      options: NavigateOptions | undefined,
      record: boolean,
    ) => {
      const workspace = useWorkspaceStore.getState();
      if (record) recordWorkspaceTabRoute(props.tab.id, nextRoute, Boolean(options?.replace));
      workspace.updateTabRoute(props.tab.id, nextRoute);
      const focusedPane = dockLeaves(workspace.layout.root).find(
        (pane) => pane.id === workspace.layout.focusedPaneId,
      );
      if (focusedPane?.activeTabId === props.tab.id) {
        // The pane owns its route stack. The address bar mirrors the focused
        // entry without duplicating that stack in the shell's browser history.
        outerNavigate(nextRoute, { ...options, state, replace: true });
      }
    };
    const commit = (to: To, state: unknown, options: NavigateOptions | undefined) => {
      const resolved = resolvePath(to, location.pathname);
      apply(createPath(resolved), state, options, true);
    };
    return {
      createHref: (to) => createPath(resolvePath(to, location.pathname)),
      encodeLocation: (to) => resolvePath(to, location.pathname),
      go: (delta) => {
        const nextRoute = navigateWorkspaceTabRoute(props.tab.id, delta);
        if (nextRoute) apply(nextRoute, null, { replace: true }, false);
      },
      push: (to, state, options) => commit(to, state, options),
      replace: (to, state, options) => commit(to, state, { ...options, replace: true }),
    };
  }, [location.pathname, outerNavigate, props.tab.id]);

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
    <WorkspaceTabIdContext.Provider value={props.tab.id}>
      <UNSAFE_NavigationContext.Provider value={navigationContext}>
        <UNSAFE_LocationContext.Provider value={locationContext}>
          <UNSAFE_RouteContext.Provider value={routeContext}>
            {props.children}
          </UNSAFE_RouteContext.Provider>
        </UNSAFE_LocationContext.Provider>
      </UNSAFE_NavigationContext.Provider>
    </WorkspaceTabIdContext.Provider>
  );
}
