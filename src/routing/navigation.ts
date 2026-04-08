import { FolderOpen, PanelsTopLeft, Puzzle } from "lucide-react";
import type { DesktopNavItem } from "@/models/types/layouts";
import { isAndroidBuild } from "@/platform/buildTarget";
import type { AppTab } from "@/models/types/routing/types";
import { routes } from "./paths";

export const desktopNavItems = [
  { id: "files", label: "Files", path: routes.files, icon: FolderOpen },
  {
    id: "spaces",
    label: "Spaces",
    path: routes.spacePersonal,
    icon: PanelsTopLeft,
    active: (pathname: string) => pathname.startsWith(routes.spaces),
  },
  ...(isAndroidBuild
    ? []
    : [
        {
          id: "extensions",
          label: "Extensions",
          path: routes.extensions,
          icon: Puzzle,
          active: (pathname: string) => pathname.startsWith(routes.extensions),
        },
      ]),
] satisfies DesktopNavItem[];

const deepLinkPrefixes = [
  routes.transfers,
  routes.files,
  routes.providers,
  routes.automations,
  routes.agents,
  routes.spaces,
  routes.studio,
  routes.account,
  routes.settings,
  routes.library,
  routes.extensions,
  routes.changelog,
  routes.signIn,
  routes.register,
];

export function desktopRouteIdFromPath(pathname: string): AppTab {
  if (pathname.startsWith(routes.spaces) || pathname.startsWith(routes.library)) return "spaces";
  if (
    pathname.startsWith(routes.studio) ||
    pathname.startsWith(routes.agents) ||
    pathname.startsWith(routes.automations)
  )
    return "agents";
  if (pathname.startsWith(routes.transfers)) return "transfers";
  if (pathname.startsWith(routes.providers)) return "providers";
  if (pathname.startsWith(routes.account)) return "account";
  if (
    pathname.startsWith(routes.extensions) ||
    pathname.startsWith(routes.changelog) ||
    pathname.startsWith(routes.signIn) ||
    pathname.startsWith(routes.register)
  )
    return "home";
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
