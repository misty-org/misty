import type { AppTab } from "@/features/app-shell";
import { routes } from "@/features/app-shell";

const deepLinkPrefixes = [
  routes.browser,
  routes.invite,
  routes.providers,
  routes.agents,
  routes.scheduled,
  routes.spaces,
  routes.settings,
  routes.signIn,
  routes.register,
];

export function desktopRouteIdFromPath(pathname: string): AppTab {
  if (pathname.startsWith(routes.browser)) return "browser";
  if (pathname.startsWith(routes.agents)) return "agents";
  if (pathname.startsWith(routes.spaces)) return "spaces";
  if (pathname.startsWith(routes.providers)) return "providers";
  if (pathname.startsWith(routes.settings)) return "settings";
  return "browser";
}

export function isDeepLinkRouteAllowed(route: string): boolean {
  return deepLinkPrefixes.some((prefix) => route === prefix || route.startsWith(`${prefix}/`));
}

export function resolveAuthDeepLinkRoute(target: "account" | "providers"): string {
  return target === "providers" ? routes.providers : routes.browser;
}
