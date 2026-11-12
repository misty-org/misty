import { Blocks, FolderGit2, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { EngineMark } from "@/features/engine-config/EngineMark";
import {
  ChoiceGroup,
  EmptyState,
  FilterChip,
  IconButton,
  ListRowSkeleton,
  OptionSelect,
  SearchField,
} from "@/shared/ui";
import { listEngines, type EngineInfo } from "../engines/enginesApi";
import {
  hasPlugins,
  kindsFor,
  pluginNoun,
  skillTargetOf,
  takesSources,
  type MarketKind,
} from "./api";
import { EnginePlugins } from "./EnginePlugins";
import { EngineSkills } from "./EngineSkills";

const kindLabels: Record<MarketKind, { label: string; icon: typeof Blocks }> = {
  plugins: { label: "Plugins", icon: Blocks },
  skills: { label: "Skills", icon: Sparkles },
};

/**
 * What each installed engine can take: its own plugins, where its CLI has marketplaces, and Agent
 * Skills, which the skills hub syncs into its skills folder. One engine at a time; nothing is
 * shared between engines unless the person installs it in each.
 */
export function EngineMarketplace() {
  const [engines, setEngines] = useState<EngineInfo[] | null>(null);
  const [engine, setEngine] = useState("");
  const [kind, setKind] = useState<MarketKind>("plugins");
  const [query, setQuery] = useState("");
  const [installedOnly, setInstalledOnly] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [refreshes, setRefreshes] = useState(0);

  useEffect(() => {
    let live = true;
    listEngines().then(
      (list) => {
        if (!live) return;
        const usable = list.filter((entry) => entry.installed && kindsFor(entry.id).length);
        setEngines(usable);
        setEngine((current) => current || usable[0]?.id || "");
      },
      () => live && setEngines([]),
    );
    return () => {
      live = false;
    };
  }, []);

  if (!engines) return <ListRowSkeleton label="Engines" rows={10} lines={2} />;
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

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2">
        <OptionSelect
          aria-label="Engine"
          value={engine}
          onValueChange={setEngine}
          options={engines.map((entry) => ({
            value: entry.id,
            label: entry.name,
            icon: <EngineMark engine={entry.id} size={16} />,
          }))}
        />
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
          containerClassName="min-w-0 flex-1"
          value={query}
          maxLength={100}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Find a ${name} ${noun}`}
          aria-label={`Find a ${name} ${noun}`}
        />
        <FilterChip label="Installed" pressed={installedOnly} onPressedChange={setInstalledOnly} />
        {shown === "plugins" && hasPlugins(engine) && takesSources(engine) ? (
          <IconButton label="Marketplaces" onClick={() => setSourcesOpen(true)}>
            <FolderGit2 size={16} />
          </IconButton>
        ) : null}
        {shown === "plugins" ? (
          <IconButton label={`Refresh ${noun}s`} onClick={() => setRefreshes((count) => count + 1)}>
            <RefreshCw size={16} />
          </IconButton>
        ) : null}
      </div>
      {shown === "plugins" && hasPlugins(engine) ? (
        <EnginePlugins
          engine={engine}
          name={name}
          query={query}
          installedOnly={installedOnly}
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
  );
}
