import { Bot } from "lucide-react";
import type { DesktopNavItem } from "@/models/types/layouts";
import type { AppTab } from "@/models/types/routing/types";
import { routes } from "./paths";
import { agentTeammatesV1Enabled } from "@/features/agents/flags";

export const desktopNavItems = [
  ...(agentTeammatesV1Enabled()
    ? []
    : [
        {
          id: "agents" as const,
          label: "Agents",
          path: routes.agents,
          icon: Bot,
          active: (pathname: string) => pathname.startsWith(routes.agents),
        },
      ]),
] satisfies DesktopNavItem[];

const deepLinkPrefixes = [
  routes.invite,
  routes.transfers,
  routes.files,
  routes.providers,
  routes.assistant,
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
  // Assistant remains an accepted legacy deep link that redirects into Agents.
  if (pathname.startsWith(routes.extensions)) return "extensions";
  if (pathname.startsWith(routes.assistant) || pathname.startsWith(routes.agents))
    return agentTeammatesV1Enabled() ? "spaces" : "agents";
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
