import { ArrowDownAZ, Blocks, Flame, RefreshCw, ScrollText } from "lucide-react";
import { useState } from "react";
import { createDeviceSetting } from "@/shared/lib/deviceSetting";
import {
  ChoiceGroup,
  EmptyState,
  FilterChip,
  IconButton,
  ListRowSkeleton,
  CollectionSortMenu,
  SearchField,
  Skeleton,
  SkeletonControl,
} from "@/shared/ui";
import { useEnginesList } from "../engines/enginesApi";
import {
  hasPlugins,
  kindsFor,
  pluginNoun,
  skillTargetOf,
  takesSources,
  type MarketKind,
  type MarketSort,
} from "./api";
import { EnginePlugins } from "./EnginePlugins";
import { EngineSkills } from "./EngineSkills";
import { EngineRail, MarketplaceRail } from "./MarketplaceRail";

const kindLabels: Record<MarketKind, { label: string; icon: typeof Blocks }> = {
  plugins: { label: "Plugins", icon: Blocks },
  skills: { label: "Skills", icon: ScrollText },
};

const sortOptions = [
  { value: "popular", label: "Most installed", icon: Flame },
  { value: "name", label: "Name", icon: ArrowDownAZ },
] as const satisfies readonly { value: MarketSort; label: string; icon: typeof Flame }[];

/** Which catalog and order the person last chose, kept for this device in `misty.db`. */
const useMarketView = createDeviceSetting<{ kind: MarketKind; sort: MarketSort }>({
  scope: "marketplace-view",
  defaults: { kind: "plugins", sort: "popular" },
  normalize: (stored) => {
    const saved = stored as { kind?: unknown; sort?: unknown } | null;
    return {
      kind: saved?.kind === "skills" ? "skills" : "plugins",
      sort: saved?.sort === "name" ? "name" : "popular",
    };
  },
});

/**
 * What each installed engine can take: its own plugins, where its CLI has marketplaces, and Agent
 * Skills, which the skills hub syncs into its skills folder. A rail picks the engine and shows its
 * marketplaces; the catalog beside it is that one engine's. Nothing is shared between engines
 * unless the person installs it in each.
 */
export function EngineMarketplace() {
  const list = useEnginesList();
  const [picked, setEngine] = useState("");
  const { kind, sort } = useMarketView((state) => state.value);
  const setKind = (next: MarketKind) =>
    useMarketView.getState().set((current) => ({ ...current, kind: next }));
  const setSort = (next: MarketSort) =>
    useMarketView.getState().set((current) => ({ ...current, sort: next }));
  const [query, setQuery] = useState("");
  const [installedOnly, setInstalledOnly] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [refreshes, setRefreshes] = useState(0);

  const engines = list.data
    ? list.data.filter((entry) => entry.installed && kindsFor(entry.id).length)
    : list.loading
      ? null
      : [];
  const engine = picked || engines?.[0]?.id || "";

  // The rail, then the bar and the catalog: the kinds, the search, the order and Refresh.
  if (!engines)
    return (
      <div aria-hidden="true" className="flex flex-wrap items-start gap-8">
        <div className="grid max-w-60 grow basis-52 gap-2">
          <Skeleton className="h-8 w-full rounded-lg" />
          <Skeleton className="h-8 w-full rounded-lg" />
          <Skeleton className="h-8 w-full rounded-lg" />
        </div>
        <div className="grid min-w-0 grow-999 basis-140 gap-4">
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-44 shrink-0 rounded-lg" />
            <Skeleton className="h-8 min-w-0 flex-1 rounded-lg" />
            <SkeletonControl kind="icon" />
            <SkeletonControl kind="icon" />
          </div>
          <ListRowSkeleton label="Plugins" rows={8} lines={2} trailing="button-sm" />
        </div>
      </div>
    );
  if (!engines.length)
    return (
      <EmptyState
        title="No engines to add to yet"
        line="Install an engine in Settings › Engines, and its plugins and skills show here."
      />
    );

  const name = engines.find((entry) => entry.id === engine)?.name ?? engine;
  const kinds = kindsFor(engine);
  const shown = kinds.includes(kind) ? kind : kinds[0];
  const target = skillTargetOf(engine);
  const noun = shown === "plugins" ? pluginNoun(engine) : "skill";
  const plugins = shown === "plugins" && hasPlugins(engine);

  return (
    <div className="flex flex-wrap items-start gap-8">
      <nav
        aria-label="Engines and marketplaces"
        data-tour="integrations-rail"
        className="grid max-w-60 grow basis-52 gap-6"
      >
        <EngineRail
          engines={engines}
          engine={engine}
          onPick={(next) => {
            setEngine(next);
            setQuery("");
          }}
        />
        {plugins && takesSources(engine) ? (
          <MarketplaceRail engine={engine} onManage={() => setSourcesOpen(true)} />
        ) : null}
      </nav>

      <div className="grid min-w-0 grow-999 basis-140 gap-6">
        <div className="flex flex-wrap items-center gap-2" data-tour="integrations-bar">
          {kinds.length > 1 ? (
            <ChoiceGroup
              label="Kind"
              value={shown}
              onChange={setKind}
              options={kinds.map((value) => ({
                value,
                ...kindLabels[value],
                ...(value === "plugins" && pluginNoun(engine) === "extension"
                  ? { label: "Extensions" }
                  : {}),
              }))}
            />
          ) : null}
          <SearchField
            containerClassName="min-w-48 flex-1"
            value={query}
            maxLength={100}
            onChange={(event) => setQuery(event.target.value)}
            onClear={() => setQuery("")}
            placeholder={`Find a ${name} ${noun}`}
            aria-label={`Find a ${name} ${noun}`}
          />
          <FilterChip
            label="Installed"
            pressed={installedOnly}
            onPressedChange={setInstalledOnly}
          />
          {plugins ? (
            <CollectionSortMenu value={sort} options={sortOptions} onChange={setSort} />
          ) : null}
          {plugins ? (
            <IconButton
              label={`Refresh ${noun}s`}
              onClick={() => setRefreshes((count) => count + 1)}
            >
              <RefreshCw />
            </IconButton>
          ) : null}
        </div>
        {plugins ? (
          <EnginePlugins
            engine={engine}
            name={name}
            query={query}
            installedOnly={installedOnly}
            sort={sort}
            sourcesOpen={sourcesOpen}
            onSourcesOpenChange={setSourcesOpen}
            refreshes={refreshes}
          />
        ) : target ? (
          <EngineSkills
            key={target}
            target={target}
            engineName={name}
            query={query}
            installedOnly={installedOnly}
          />
        ) : null}
      </div>
    </div>
  );
}
