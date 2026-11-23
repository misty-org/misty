import {
  Blocks,
  Cable,
  CircleArrowDown,
  Compass,
  FileText,
  LayoutGrid,
  ScrollText,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { McpSection } from "@/features/engine-config/mcp";
import { PromptsSection } from "@/features/engine-config/prompts";
import { exploreApps } from "./explore_apps";
import {
  appIcons,
  FramedPage,
  NavList,
  NavRow,
  OverflowFadeText,
  SearchField,
  Separator,
  Text,
} from "@misty/ui";
import { DirectApps } from "../connected-apps/DirectApps";
import { EngineConnectors } from "./EngineConnectors";
import { PersonaCatalogSection } from "../personas";
import { EnginesSection } from "./EnginesSection";
import { PluginsSection } from "./PluginsSection";
import { SkillsSection } from "./SkillsSection";
import { SpeechSection } from "./SpeechSection";
import {
  UpdatesSection,
  useEngineUpdates,
  useSkillUpdates,
  useSpeechUpdates,
} from "./UpdatesSection";

export const marketTabs = [
  "all",
  "apps",
  "agents",
  "engines",
  "speech",
  "plugins",
  "skills",
  "prompts",
  "mcp",
  "connections",
  "updates",
] as const;
export type MarketTab = (typeof marketTabs)[number];

type Section = Exclude<MarketTab, "connections">;
const rail: { value: Section; label: string; icon: LucideIcon }[] = [
  { value: "all", label: "All", icon: Compass },
  { value: "apps", label: "Apps", icon: LayoutGrid },
  { value: "agents", label: "Templates", icon: Users },
  { value: "engines", label: "Engines", icon: appIcons.engines },
  { value: "speech", label: "Speech", icon: appIcons.speech },
  { value: "plugins", label: "Plugins", icon: Blocks },
  { value: "skills", label: "Skills", icon: ScrollText },
  { value: "prompts", label: "Prompts", icon: FileText },
  { value: "mcp", label: "Connectors", icon: Cable },
];

const pickedPersonas = [
  "engineering-frontend-developer",
  "engineering-backend-architect",
  "design-ui-designer",
  "engineering-code-reviewer",
  "engineering-technical-writer",
  "marketing-growth-hacker",
];

interface ExplorePageProps {
  spaceId: string;
  canManageApps: boolean;
}

const isMarketTab = (value: string | null): value is MarketTab =>
  marketTabs.some((tab) => tab === value);

export function ExplorePage({ spaceId, canManageApps }: ExplorePageProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const asked = new URLSearchParams(location.search).get("tab");
  const tab: MarketTab = isMarketTab(asked) ? asked : "all";
  const open: Section = tab === "connections" ? "mcp" : tab;
  const [query, setQuery] = useState("");
  const { useAppUpdates, ExploreAppsSection } = exploreApps();
  const appUpdates = useAppUpdates(spaceId).updates.length;
  const skillUpdates = useSkillUpdates().rows?.length ?? 0;
  const engineUpdates = useEngineUpdates({ probe: false }).rows.length;
  const speechUpdates = useSpeechUpdates()?.length ?? 0;
  const updates = (canManageApps ? appUpdates : 0) + skillUpdates + engineUpdates + speechUpdates;

  const go = (next: MarketTab) => {
    const params = new URLSearchParams(location.search);
    params.set("tab", next);
    navigate(`${location.pathname}?${params}`, { replace: true });
  };

  const sections: Record<Section, () => ReactNode> = {
    all: () => (
      <>
        <ExploreAppsSection
          spaceId={spaceId}
          canManage={canManageApps}
          query={query}
          limit={6}
          featured
          onSeeAll={() => go("apps")}
        />
        <PersonaCatalogSection
          query={query}
          picks={pickedPersonas}
          title="Templates"
          onSeeAll={() => go("agents")}
        />
      </>
    ),
    apps: () => <ExploreAppsSection spaceId={spaceId} canManage={canManageApps} query={query} />,
    agents: () => <PersonaCatalogSection query={query} />,
    engines: () => <EnginesSection query={query} />,
    speech: () => <SpeechSection query={query} />,
    plugins: () => <PluginsSection query={query} />,
    skills: () => <SkillsSection query={query} />,
    prompts: () => <PromptsSection query={query} />,
    mcp: () => (
      <McpSection
        query={query}
        lead={(engine) => (engine === "claude" ? <EngineConnectors /> : null)}
        after={<DirectApps query={query} />}
      />
    ),
    updates: () => <UpdatesSection spaceId={spaceId} canManage={canManageApps} />,
  };

  const railColumn = (
    <nav
      aria-label="Explore"
      className="grid size-full content-start gap-3 overflow-y-auto px-3 py-4"
    >
      <SearchField
        aria-label="Search Explore"
        placeholder="Search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onClear={() => setQuery("")}
      />
      <NavList>
        {rail.map(({ value, label, icon: Icon }) => (
          <NavRow key={value} current={open === value} onClick={() => go(value)}>
            <Icon />
            <OverflowFadeText>{label}</OverflowFadeText>
          </NavRow>
        ))}
      </NavList>
      <Separator />
      <NavList>
        <NavRow current={open === "updates"} onClick={() => go("updates")}>
          <CircleArrowDown />
          <OverflowFadeText>Updates</OverflowFadeText>
          {updates ? (
            <Text size="caption" tone="muted" className="ml-auto tabular-nums">
              {updates}
            </Text>
          ) : null}
        </NavRow>
      </NavList>
    </nav>
  );

  return (
    <FramedPage
      autoSaveId="explore"
      start={{
        id: "explore-rail",
        label: "Resize the rail",
        defaultSize: 18,
        minSize: 14,
        maxSize: 30,
        content: railColumn,
      }}
    >
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-8 pt-4 pb-10">
          {sections[open]()}
        </div>
      </main>
    </FramedPage>
  );
}
