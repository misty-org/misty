import type { DesktopNavItem } from "@/application/layouts/model/types";
import type { AppTab } from "@/features/app-shell";
import { routes } from "@/features/app-shell";
import { ArrowLeftRight, Bot, FolderOpen, House, Store } from "lucide-react";

export const desktopNavItems: DesktopNavItem[] = [
  { id: "home", label: "Home", path: routes.home, icon: House, exact: true },
  { id: "files", label: "Files", path: routes.files, icon: FolderOpen },
  { id: "transfers", label: "Transfers", path: routes.transfers, icon: ArrowLeftRight },
  { id: "agents", label: "Agents", path: routes.agents, icon: Bot },
  { id: "marketplace", label: "Store", path: routes.store, icon: Store },
];

const deepLinkPrefixes = [
  routes.home,
  routes.inbox,
  routes.browser,
  routes.terminal,
  routes.invite,
  routes.transfers,
  routes.files,
  routes.code,
  routes.providers,
  routes.assistant,
  routes.automations,
  routes.agents,
  routes.spaces,
  routes.studio,
  routes.account,
  routes.settings,
  routes.library,
  routes.store,
  "/marketplace",
  routes.changelog,
  routes.signIn,
  routes.register,
];

export function desktopRouteIdFromPath(pathname: string): AppTab {
  if (pathname === routes.home) return "home";
  if (pathname.startsWith(routes.inbox)) return "inbox";
  if (pathname.startsWith(routes.browser)) return "browser";
  if (pathname.startsWith(routes.terminal)) return "terminal";
  if (pathname.startsWith(routes.files)) return "files";
  if (pathname.startsWith(routes.code)) return "code";
  if (pathname.startsWith(routes.store) || pathname.startsWith("/marketplace"))
    return "marketplace";
  // Assistant remains an accepted legacy deep link that redirects into Agents.
  if (pathname.startsWith(routes.assistant) || pathname.startsWith(routes.agents)) return "agents";
  if (pathname.startsWith(routes.spaces) || pathname.startsWith(routes.library)) return "spaces";
  if (pathname.startsWith(routes.studio) || pathname.startsWith(routes.automations))
    return "spaces";
  if (pathname.startsWith(routes.transfers)) return "transfers";
  if (pathname.startsWith(routes.providers)) return "providers";
  if (pathname.startsWith(routes.account)) return "account";
  if (
    pathname.startsWith(routes.changelog) ||
    pathname.startsWith(routes.signIn) ||
    pathname.startsWith(routes.register)
  )
    return "files";
  if (pathname.startsWith(routes.settings)) return "settings";
  if (pathname.startsWith(routes.diagnostics)) return "diagnostics";
  return "files";
}

export function isDeepLinkRouteAllowed(route: string): boolean {
  return deepLinkPrefixes.some((prefix) => route === prefix || route.startsWith(`${prefix}/`));
}

export function resolveAuthDeepLinkRoute(target: "account" | "providers"): string {
  return target === "providers" ? routes.providers : routes.account;
}
