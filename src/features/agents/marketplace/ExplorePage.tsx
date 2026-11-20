import {
  Blocks,
  Cable,
  FileText,
  Link,
  Plug,
  ScrollText,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { McpSection } from "@/features/engine-config/mcp";
import { PromptsSection } from "@/features/engine-config/prompts";
import { SkillsHub } from "@/features/engine-config/skills";
import { ExploreAppsSection } from "@/features/spaces/apps/ExploreAppsSection";
import { ChoiceGroup, spaceIcons, ViewHeader } from "@misty/ui";
import { AppsPage } from "../connected-apps/AppsPage";
import { PersonaCatalogSection } from "../personas";
import { EngineMarketplace, showSkillCatalog } from "./EngineMarketplace";

/** What Explore offers, in tab order. */
export const marketTabs = [
  "agents",
  "apps",
  "plugins",
  "skills",
  "prompts",
  "mcp",
  "connections",
] as const;
export type MarketTab = (typeof marketTabs)[number];

const agentTabs = ["agents", "plugins", "skills", "prompts", "mcp"] as const;
const appTabs = ["apps", "connections"] as const;
type ExploreGroup = "agents" | "apps";

interface ExplorePageProps {
  spaceId: string;
  canManageApps: boolean;
}

const tabInfo: Record<MarketTab, { label: string; icon: LucideIcon }> = {
  agents: { label: "Personas", icon: Users },
  apps: { label: "Apps", icon: Plug },
  plugins: { label: "Plugins", icon: Blocks },
  skills: { label: "Skills", icon: ScrollText },
  prompts: { label: "Prompts", icon: FileText },
  mcp: { label: "Connectors", icon: Cable },
  connections: { label: "Connected apps", icon: Link },
};

const tabContent: Record<MarketTab, (props: ExplorePageProps) => ReactNode> = {
  agents: () => <PersonaCatalogSection />,
  apps: ({ spaceId, canManageApps }) => (
    <ExploreAppsSection spaceId={spaceId} canManage={canManageApps} />
  ),
  plugins: () => <EngineMarketplace />,
  skills: () => <SkillsHub onBrowse={showSkillCatalog} />,
  prompts: () => <PromptsSection />,
  mcp: () => <McpSection />,
  connections: () => <AppsPage />,
};

const isMarketTab = (value: string | null): value is MarketTab =>
  marketTabs.some((tab) => tab === value);

const isAppTab = (tab: MarketTab): tab is (typeof appTabs)[number] =>
  appTabs.includes(tab as (typeof appTabs)[number]);

/** The Space's catalog for agents, apps and the tools agents can use. */
export function ExplorePage(props: ExplorePageProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const asked = new URLSearchParams(location.search).get("tab");
  const tab: MarketTab = isMarketTab(asked) ? asked : "agents";
  const group: ExploreGroup = isAppTab(tab) ? "apps" : "agents";
  const categories: readonly MarketTab[] = group === "agents" ? agentTabs : appTabs;
  const choose = (next: MarketTab) => {
    const params = new URLSearchParams(location.search);
    params.set("tab", next);
    navigate(`${location.pathname}?${params}`, { replace: true });
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewHeader title="Explore" lead={spaceIcons.explore} />
      <div className="grid shrink-0 gap-1.5 px-4 pb-3">
        <ChoiceGroup<ExploreGroup>
          label="Explore"
          value={group}
          onChange={(next) => choose(next)}
          fill
          options={[
            { value: "agents", label: "Agents", icon: Users },
            { value: "apps", label: "Apps", icon: Plug },
          ]}
        />
        <ChoiceGroup
          label={`${group === "agents" ? "Agents" : "Apps"} categories`}
          value={tab}
          onChange={choose}
          fill
          options={categories.map((value) => ({ value, ...tabInfo[value] }))}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8">
        <div className="mx-auto w-full max-w-5xl">{tabContent[tab](props)}</div>
      </div>
    </div>
  );
}
