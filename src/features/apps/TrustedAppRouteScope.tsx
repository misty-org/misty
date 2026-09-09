import { useMemo, type ReactNode } from "react";
import {
  createPath,
  resolvePath,
  parsePath,
  NavigationType,
  useNavigate,
  UNSAFE_LocationContext,
  UNSAFE_NavigationContext,
  UNSAFE_RouteContext,
  type Navigator,
  type To,
  type NavigateOptions,
} from "react-router-dom";
import { hostAppRoute, packageRoute } from "./package/routes";

/** Adapt feature routes without a second browser document or a nested Router. */
export function TrustedAppRouteScope(props: {
  appId: string;
  spaceId: string;
  route: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const route = packageRoute(props.appId, props.spaceId, props.route);
  const location = useMemo(
    () => ({
      pathname: "/",
      search: "",
      hash: "",
      ...parsePath(route),
      state: null,
      key: props.appId,
    }),
    [props.appId, route],
  );
  const navigator = useMemo<Navigator>(() => {
    const destination = (to: To) => {
      const path = createPath(resolvePath(to, location.pathname));
      return hostAppRoute(props.appId, props.spaceId, path);
    };
    const commit = (to: To, state: unknown, options?: NavigateOptions) =>
      navigate(destination(to), { ...options, state });
    return {
      createHref: destination,
      encodeLocation: (to) => resolvePath(destination(to)),
      go: (delta) => navigate(delta),
      push: commit,
      replace: (to, state, options) => commit(to, state, { ...options, replace: true }),
    };
  }, [location.pathname, navigate, props.appId, props.spaceId]);
  const navigationContext = useMemo(
    () => ({ basename: "/", navigator, static: false, useTransitions: false, future: {} }),
    [navigator],
  );
  const routeContext = useMemo(() => ({ outlet: null, matches: [], isDataRoute: false }), []);
  return (
    <UNSAFE_NavigationContext.Provider value={navigationContext}>
      <UNSAFE_LocationContext.Provider value={{ location, navigationType: NavigationType.Pop }}>
        <UNSAFE_RouteContext.Provider value={routeContext}>
          {props.children}
        </UNSAFE_RouteContext.Provider>
      </UNSAFE_LocationContext.Provider>
    </UNSAFE_NavigationContext.Provider>
  );
}
