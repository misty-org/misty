import {
  Blocks,
  ChartColumn,
  FileText,
  Plug,
  Route,
  ScrollText,
  Server,
  SquareTerminal,
  UserRound,
  Users,
  Variable,
} from "lucide-react";
import { useEffect, type ComponentType } from "react";
import {
  AppsPage,
  EngineMarketplace,
  HubAgentsPage,
  PersonaCatalogSection,
  showSkillCatalog,
  useAgentsHub,
  type AgentsHubPage,
} from "@/features/agents";
import { ChannelsSection } from "@/features/engine-config/channels";
import { ClisSection } from "@/features/engine-config/clis";
import { EnvironmentSection } from "@/features/engine-config/environment";
import { McpSection } from "@/features/engine-config/mcp";
import { PromptsSection } from "@/features/engine-config/prompts";
import { SkillsHub } from "@/features/engine-config/skills";
import { UsageSection } from "@/features/engine-config/usage";
import type { WorkspaceView } from "@/features/app-windows";
import { startTour, TourInfoButton, useTours } from "@/features/onboarding";
import { DesktopSettingsFrame, type DesktopSettingsNavGroup } from "@/features/settings";
import { WorkspaceOverlay } from "@/shared/ui";
import { agentChatRoute, openWorkspaceRoute } from "./spaceNavigation";

const groups: DesktopSettingsNavGroup<AgentsHubPage>[] = [
  {
    label: "Agents",
    items: [
      { id: "agents", label: "Your agents", icon: Users },
      { id: "personas", label: "Personas", icon: UserRound },
    ],
  },
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
      { id: "skills", label: "Skills", icon: ScrollText },
      { id: "prompts", label: "Prompts", icon: FileText },
      { id: "mcp", label: "MCP servers", icon: Server },
      { id: "apps", label: "Apps", icon: Plug },
    ],
  },
];

/**
 * Every page but Your agents. Each is the one place its subject lives: Settings keeps only
 * switches, and nothing here is shown again anywhere else.
 */
const enginePages: Record<Exclude<AgentsHubPage, "agents">, ComponentType> = {
  personas: PersonaCatalogSection,
  clis: ClisSection,
  channels: ChannelsSection,
  environment: () => <EnvironmentSection />,
  usage: UsageSection,
  plugins: EngineMarketplace,
  mcp: McpSection,
  skills: () => <SkillsHub onBrowse={showSkillCatalog} />,
  prompts: PromptsSection,
  apps: AppsPage,
};

/**
 * The Agents window, opened from the sidebar's Agents row: the person's agents to start a chat
 * with or make and the personas to make one from, then everything their engines' CLIs take, in
 * one place: installing, updating and signing in, channels, environment variables, usage,
 * plugins, skills, prompts, MCP servers and the apps agents sign in to.
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
  // The top bar names the page, as Settings does.
  const title =
    groups.flatMap((group) => group.items).find((item) => item.id === page)?.label ?? "";
  return (
    <WorkspaceOverlay open={open} onClose={close} ariaLabel="Agents">
      <DesktopSettingsFrame
        presentation="overlay"
        ariaLabel="Agents"
        navigationLabel="Agents"
        title={title}
        groups={groups}
        activeId={page}
        onSelect={(next) => useAgentsHub.getState().setPage(next)}
        onClose={close}
        corner={<TourInfoButton tour="agents" />}
        navigationTour="agents-nav"
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
