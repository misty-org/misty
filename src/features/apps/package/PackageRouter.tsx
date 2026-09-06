import { useLayoutEffect, useRef } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import type { OfficialAppPackageMountProps } from "./types";
import { hostAppRoute, packageRoute } from "./routes";

export function PackageRouter({
  props,
  renderApp,
}: {
  props: OfficialAppPackageMountProps;
  renderApp: (props: OfficialAppPackageMountProps) => React.ReactNode;
}) {
  const route = packageRoute(
    props.session.appId,
    props.session.spaceId,
    `${props.route}${props.search}`,
  );
  return (
    <MemoryRouter initialEntries={[route]}>
      <PackageLocation props={props} hostRoute={route} renderApp={renderApp} />
    </MemoryRouter>
  );
}

function PackageLocation({
  props,
  hostRoute,
  renderApp,
}: {
  props: OfficialAppPackageMountProps;
  hostRoute: string;
  renderApp: (props: OfficialAppPackageMountProps) => React.ReactNode;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const previousHostRoute = useRef(hostRoute);
  const previousLocation = useRef(hostRoute);
  const route = `${location.pathname}${location.search}${location.hash}`;
  useLayoutEffect(() => {
    if (hostRoute !== previousHostRoute.current) {
      previousHostRoute.current = hostRoute;
      previousLocation.current = hostRoute;
      if (route !== hostRoute) void navigate(hostRoute, { replace: true });
      return;
    }
    if (route === previousLocation.current) return;
    previousLocation.current = route;
    if (props.tab)
      props.onWorkspaceTabChange?.({
        ...props.tab,
        route: hostAppRoute(props.session.appId, props.session.spaceId, route),
      });
  }, [hostRoute, navigate, props, route]);
  return renderApp({ ...props, route: location.pathname, search: location.search });
}
