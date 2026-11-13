import {
  Blocks,
  ChartColumn,
  MessageSquareText,
  Route,
  ScrollText,
  Server,
  SquareTerminal,
  Users,
  Variable,
} from "lucide-react";
import { useEffect, type ComponentType } from "react";
import {
  EngineMarketplace,
  HubAgentsPage,
  useAgentsHub,
  type AgentsHubPage,
} from "@/features/agents";
import { ChannelsSection } from "@/features/engine-config/channels";
import { ClisSection } from "@/features/engine-config/clis";
import { EnvironmentSection } from "@/features/engine-config/environment";
import { McpSection } from "@/features/engine-config/mcp";
import { PromptsSection } from "@/features/engine-config/prompts";
import { SkillsSection } from "@/features/engine-config/skills";
import { UsageSection } from "@/features/engine-config/usage";
import type { WorkspaceView } from "@/features/app-windows";
import { startTour, useTours } from "@/features/onboarding";
import { DesktopSettingsFrame, type DesktopSettingsNavGroup } from "@/features/settings";
import { WorkspaceOverlay } from "@/shared/ui";
import { agentChatRoute, openWorkspaceRoute } from "./spaceNavigation";

const groups: DesktopSettingsNavGroup<AgentsHubPage>[] = [
  { label: "Agents", items: [{ id: "agents", label: "Your agents", icon: Users }] },
  {
    label: "Engines",
    items: [
      { id: "clis", label: "CLIs", icon: SquareTerminal },
      { id: "channels", label: "Channels", icon: Route },
      { id: "environment", label: "Environment", icon: Variable },
      { id: "usage", label: "Usage", icon: ChartColumn },
    ],
  },
  {
    label: "Tools",
    items: [
      { id: "plugins", label: "Plugins", icon: Blocks },
      { id: "mcp", label: "MCP servers", icon: Server },
      { id: "skills", label: "Skills", icon: ScrollText },
      { id: "prompts", label: "Prompts", icon: MessageSquareText },
    ],
  },
];

/** Each engine page is the same block Settings shows, so the two never drift apart. */
const enginePages: Record<Exclude<AgentsHubPage, "agents">, ComponentType> = {
  clis: ClisSection,
  channels: ChannelsSection,
  environment: () => <EnvironmentSection />,
  usage: UsageSection,
  plugins: EngineMarketplace,
  mcp: McpSection,
  skills: SkillsSection,
  prompts: PromptsSection,
};

/**
 * The Agents window, opened from the sidebar's Agents row: the person's agents to start a chat
 * with or make, then everything their engines' CLIs take, in one place: installing, updating and
 * signing in, channels, environment variables, usage, plugins, MCP servers, skills and prompts.
 * It opens over the window like Settings, and the first time it opens its tour shows around.
 */
export function AgentsHub({ onOpen }: { onOpen(view: WorkspaceView): void }) {
  const open = useAgentsHub((state) => state.open);
  const page = useAgentsHub((state) => state.page);
  const close = () => useAgentsHub.getState().close();
  useEffect(() => {
    if (!open) return;
    const tours = useTours.getState();
    if (tours.loaded && !tours.seen.includes("agents")) startTour("agents");
  }, [open]);
  const Page = page === "agents" ? null : enginePages[page];
  return (
    <WorkspaceOverlay open={open} onClose={close} ariaLabel="Agents">
      <DesktopSettingsFrame
        presentation="overlay"
        ariaLabel="Agents"
        navigationLabel="Agents"
        title=""
        groups={groups}
        activeId={page}
        onSelect={(next) => useAgentsHub.getState().setPage(next)}
        onClose={close}
      >
        {Page ? (
          <Page />
        ) : (
          <HubAgentsPage
            onChat={(agent) => {
              close();
              openWorkspaceRoute(agentChatRoute(agent.id, undefined, true), onOpen);
            }}
          />
        )}
      </DesktopSettingsFrame>
    </WorkspaceOverlay>
  );
}
