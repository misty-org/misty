import type { AppTab } from "@/features/app-shell";
import { routes } from "@/features/app-shell";

const deepLinkPrefixes = [
  routes.home,
  routes.browser,
  routes.invite,
  routes.files,
  routes.providers,
  routes.agents,
  routes.activity,
  routes.scheduled,
  routes.spaces,
  routes.settings,
  routes.signIn,
  routes.register,
];

export function desktopRouteIdFromPath(pathname: string): AppTab {
  if (pathname === routes.home) return "home";
  if (pathname.startsWith(routes.browser)) return "browser";
  if (pathname.startsWith(routes.files)) return "files";
  if (pathname.startsWith(routes.agents)) return "agents";
  if (pathname.startsWith(routes.spaces)) return "spaces";
  if (pathname.startsWith(routes.providers)) return "providers";
  if (pathname.startsWith(routes.settings)) return "settings";
  return "files";
}

export function isDeepLinkRouteAllowed(route: string): boolean {
  return deepLinkPrefixes.some((prefix) => route === prefix || route.startsWith(`${prefix}/`));
}

export function resolveAuthDeepLinkRoute(target: "account" | "providers"): string {
  return target === "providers" ? routes.providers : routes.home;
}
