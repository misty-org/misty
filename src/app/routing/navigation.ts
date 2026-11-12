import type { AppTab } from "@/app/shell";
import { routes } from "@/app/shell";

const deepLinkPrefixes = [
  routes.invite,
  routes.agents,
  routes.spaces,
  routes.settings,
  routes.signIn,
  routes.register,
];

export function desktopRouteIdFromPath(pathname: string): AppTab {
  if (pathname.startsWith(routes.agents)) return "agents";
  if (pathname.startsWith(routes.spaces)) return "spaces";
  if (pathname.startsWith(routes.settings)) return "settings";
  return "agents";
}

export function isDeepLinkRouteAllowed(route: string): boolean {
  return deepLinkPrefixes.some((prefix) => route === prefix || route.startsWith(`${prefix}/`));
}

export function resolveAuthDeepLinkRoute(): string {
  return routes.agents;
}
