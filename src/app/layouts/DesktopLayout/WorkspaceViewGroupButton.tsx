import { spaceWorkspaceToolFromRoute, type WorkspaceView } from "@/features/app-windows";
import { workspaceAppIcon } from "@/features/app-windows";
import { appIconStrokeWidth, BrandIcon, brandIconAsset, Text } from "@/shared/ui";
import { Armchair, FlaskConical, Waypoints, type LucideIcon } from "lucide-react";
import { AgentAvatar, usePersonalAgentsStore } from "@/features/agents";
import { DestinationIcon } from "./NavigatorDestinationIcon";
function getViewAppId(tab: WorkspaceView | undefined): string {
  if (!tab) return "";
  if (tab.surfaceId === "space") {
    const tool = spaceWorkspaceToolFromRoute(tab.route);
    return tool === "space" ? "home" : tool;
  }
  return tab.surfaceId;
}
function getViewIcon(tab: WorkspaceView | undefined, fallback: LucideIcon): LucideIcon {
  return (
    workspaceAppIcon(getViewAppId(tab), tab?.surfaceId === "space" ? "space" : "app") ?? fallback
  );
}
/** The Agents pages that aren't a chat, with the icons their sidebar rows wear. */
const agentsPlaceIcons: Record<string, LucideIcon> = {
  lab: FlaskConical,
  studio: Armchair,
  integrations: Waypoints,
};

/**
 * A chat's agent, as its sidebar row shows it: the engine's own logo, never a generic agent
 * glyph. A new chat with no agent named yet shows the agent new chats start with.
 */
function ChatAgentIcon({ route }: { route: string }) {
  const agentId = new URL(route, "https://misty.local").searchParams.get("agent");
  const agent = usePersonalAgentsStore((state) =>
    agentId
      ? state.agents.find((item) => item.id === agentId)
      : (state.agents.find(
          (item) => item.id === state.selected.global && item.enabled && !item.system_managed,
        ) ??
        state.agents.find((item) => item.engine && item.enabled) ??
        state.agents.find((item) => item.system_managed)),
  );
  return <AgentAvatar agent={agent} compact />;
}

export function ViewIcon({
  tab,
  icon: DefaultIcon,
  size = 16,
  isActive = false,
}: {
  tab?: WorkspaceView;
  icon: LucideIcon;
  size?: number;
  isActive?: boolean;
}) {
  const place =
    tab?.surfaceId === "agents"
      ? new URL(tab.route, "https://misty.local").searchParams.get("view")
      : null;
  if (tab?.surfaceId === "agents" && !place) return <ChatAgentIcon route={tab.route} />;
  const appId = getViewAppId(tab);
  if (brandIconAsset(appId)) return <BrandIcon brand={appId} size={size} />;
  const section = tab ? new URL(tab.route, "https://misty.local").searchParams.get("view") : null;
  if (
    tab &&
    section &&
    ["notes", "drawings", "explorer", "recent", "favorites", "collections", "deleted"].includes(
      section,
    )
  )
    return (
      <span className="inline-flex shrink-0 [&_svg]:!size-4">
        <DestinationIcon
          appId={appId}
          item={{
            id: section,
            label: section,
            route: tab.route,
          }}
        />
      </span>
    );
  const ResolvedIcon = (place && agentsPlaceIcons[place]) || getViewIcon(tab, DefaultIcon);
  return (
    <Text bare tone={isActive ? "bright" : "muted"} className="inline-flex shrink-0">
      <ResolvedIcon size={size} className="shrink-0" strokeWidth={appIconStrokeWidth} />
    </Text>
  );
}
