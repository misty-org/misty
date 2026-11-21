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
import { exploreApps } from "./exploreApps";
import { NavList, NavRow, OverflowFadeText, SearchField, Separator, Text } from "@misty/ui";
import { PersonaCatalogSection } from "../personas";
import { PluginsSection } from "./PluginsSection";
import { SkillsSection } from "./SkillsSection";
import { UpdatesSection, useSkillUpdates } from "./UpdatesSection";

/**
 * What Explore offers, as the `?tab=` it opens on. `agents` is the templates (the persona pack), `mcp` the
 * connectors, and `connections` opens Apps on the apps agents sign in to.
 */
export const marketTabs = [
  "all",
  "apps",
  "agents",
  "plugins",
  "skills",
  "prompts",
  "mcp",
  "connections",
  "updates",
] as const;
export type MarketTab = (typeof marketTabs)[number];

/** The rail's sections, in order; Updates sits apart under a hairline. */
type Section = Exclude<MarketTab, "connections">;
const rail: { value: Section; label: string; icon: LucideIcon }[] = [
  { value: "all", label: "All", icon: Compass },
  { value: "apps", label: "Apps", icon: LayoutGrid },
  { value: "agents", label: "Templates", icon: Users },
  { value: "plugins", label: "Plugins", icon: Blocks },
  { value: "skills", label: "Skills", icon: ScrollText },
  { value: "prompts", label: "Prompts", icon: FileText },
  { value: "mcp", label: "Connectors", icon: Cable },
];

/** The personas All shows on its one agents shelf, by the last part of their id. */
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

/**
 * The Space's store, after the App Store: a rail of sections on the left (search, All, the kinds
 * of thing, then Updates), and the open section's shelves beside it. Apps come first, as Misty's
 * backbone; agents and what they use follow.
 */
export function ExplorePage({ spaceId, canManageApps }: ExplorePageProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const asked = new URLSearchParams(location.search).get("tab");
  const tab: MarketTab = isMarketTab(asked) ? asked : "all";
  const open: Section = tab === "connections" ? "apps" : tab;
  const [query, setQuery] = useState("");
  const { useAppUpdates, ExploreAppsSection } = exploreApps();
  const appUpdates = useAppUpdates(spaceId).updates.length;
  const skillUpdates = useSkillUpdates().rows?.length ?? 0;
  const updates = (canManageApps ? appUpdates : 0) + skillUpdates;

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
          only={["open"]}
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
    apps: () => (
      <ExploreAppsSection
        key={tab}
        spaceId={spaceId}
        canManage={canManageApps}
        query={query}
        startGroup={tab === "connections" ? "connected" : "all"}
      />
    ),
    agents: () => <PersonaCatalogSection query={query} />,
    plugins: () => <PluginsSection query={query} />,
    skills: () => <SkillsSection query={query} />,
    prompts: () => <PromptsSection query={query} />,
    mcp: () => <McpSection query={query} />,
    updates: () => <UpdatesSection spaceId={spaceId} canManage={canManageApps} />,
  };

  return (
    <div className="flex h-full min-h-0">
      <nav
        aria-label="Explore"
        className="grid w-56 shrink-0 content-start gap-3 overflow-y-auto px-3 py-4"
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
            <NavRow key={value} tone="page" current={open === value} onClick={() => go(value)}>
              <Icon />
              <OverflowFadeText>{label}</OverflowFadeText>
            </NavRow>
          ))}
        </NavList>
        <Separator />
        <NavList>
          <NavRow tone="page" current={open === "updates"} onClick={() => go("updates")}>
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
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-8 pt-4 pb-10">
          {sections[open]()}
        </div>
      </main>
    </div>
  );
}
