import { FolderGit2 } from "lucide-react";
import { useState } from "react";
import { EngineMark } from "@/features/engine-config/EngineMark";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import {
  Button,
  ErrorState,
  ListRow,
  NavList,
  NavRow,
  notify,
  OverflowFadeText,
  SectionHeading,
  Skeleton,
} from "@misty/ui";
import { failureText, marketApi, unaddedSuggestions, type MarketEngine } from "./api";
import { MakerLogo, pluginMaker } from "./PluginMaker";
import { useEngineMarket } from "./useEngineMarket";

/** The engines the page can add to, each with its own mark. */
export function EngineRail({
  engines,
  engine,
  onPick,
}: {
  engines: { id: string; name: string }[];
  engine: string;
  onPick(engine: string): void;
}) {
  return (
    <section className="grid gap-1" aria-label="Engines">
      <SectionHeading title="Engine" as="h3" />
      <NavList>
        {engines.map((entry) => (
          <NavRow
            key={entry.id}
            tone="page"
            current={entry.id === engine}
            onClick={() => onPick(entry.id)}
          >
            <EngineMark engine={entry.id} name={entry.name} size={16} />
            <OverflowFadeText>{entry.name}</OverflowFadeText>
          </NavRow>
        ))}
      </NavList>
    </section>
  );
}

/** A marketplace's address as a link to it, when it is on GitHub (`owner/repo` or a URL). */
function githubLink(location: string) {
  if (/^[\w.-]+\/[\w.-]+$/.test(location)) return `https://github.com/${location}`;
  return /^https:\/\/github\.com\//.test(location) ? location.replace(/\.git$/, "") : null;
}

/**
 * The marketplaces an engine reads plugins from, under the engines: the ones it has, then the
 * suggested ones it doesn't, each added with one click. Managing them opens the full list.
 */
export function MarketplaceRail({ engine, onManage }: { engine: MarketEngine; onManage(): void }) {
  const listing = useEngineMarket(engine);
  const [adding, setAdding] = useState<string | null>(null);
  const market = listing.data;
  if (!market && listing.loading) return <MarketplaceRailSkeleton />;
  if (!market?.ready)
    return (
      <section className="grid gap-1" aria-label="Marketplaces">
        <SectionHeading title="Marketplaces" as="h3" />
        <ErrorState
          inline
          title="Marketplaces couldn't load"
          line={market?.error ?? failureText(listing.error, "The marketplaces couldn't be listed.")}
          action={{
            label: "Try again",
            variant: "secondary",
            onClick: () => void listing.reload(),
          }}
        />
      </section>
    );
  const suggestions = unaddedSuggestions(engine, market.sources);

  const add = async (source: string, name: string) => {
    setAdding(source);
    try {
      await marketApi.addSource(engine, source);
      await listing.reload();
      notify({ message: `${name} is added. Its plugins are in the list.` });
    } catch (reason) {
      notify({ message: failureText(reason, `${name} couldn't be added.`), tone: "error" });
    } finally {
      setAdding(null);
    }
  };

  return (
    <section className="grid gap-1" aria-label="Marketplaces">
      <SectionHeading
        title="Marketplaces"
        as="h3"
        count={market.sources.length}
        action={{ label: "Manage marketplaces", icon: FolderGit2, onSelect: onManage }}
      />
      <NavList>
        {market.sources.map((source) => {
          const link = githubLink(source.location);
          return (
            <NavRow
              key={source.name}
              tone="page"
              onClick={() => (link ? openExternalLink(link) : onManage())}
            >
              <MakerLogo maker={pluginMaker({ link })} name={source.name} size="sm" />
              <OverflowFadeText>{source.name}</OverflowFadeText>
            </NavRow>
          );
        })}
      </NavList>
      {suggestions.length ? (
        <section className="grid gap-1 pt-3" aria-label="Suggested">
          <SectionHeading title="Suggested" as="h3" />
          {suggestions.map((suggestion) => {
            const link = `https://github.com/${suggestion.source}`;
            return (
              <ListRow
                key={suggestion.source}
                leading={
                  <MakerLogo maker={pluginMaker({ link })} name={suggestion.name} size="sm" />
                }
                label={suggestion.name}
                description={suggestion.line}
                onOpen={() => openExternalLink(link)}
                trailing={
                  <Button
                    size="sm"
                    variant="quiet"
                    aria-label={`Add ${suggestion.name}`}
                    disabled={adding !== null}
                    onClick={() => void add(suggestion.source, suggestion.name)}
                  >
                    Add
                  </Button>
                }
              />
            );
          })}
        </section>
      ) : null}
    </section>
  );
}

const sourceNameWidths = ["w-1/2", "w-2/3", "w-2/5"];

/** The marketplaces before the engine has listed them: its heading over a few rows. */
function MarketplaceRailSkeleton() {
  return (
    <section className="grid gap-1" aria-label="Marketplaces" aria-busy="true">
      <SectionHeading title="Marketplaces" as="h3" />
      <NavList aria-hidden="true">
        {sourceNameWidths.map((width) => (
          <NavRow key={width} still tone="page">
            <Skeleton className="size-4 shrink-0 rounded-sm" />
            <Skeleton className={`h-3 ${width}`} />
          </NavRow>
        ))}
      </NavList>
    </section>
  );
}
