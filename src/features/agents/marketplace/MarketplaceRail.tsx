import { FolderGit2 } from "lucide-react";
import { useState } from "react";
import { EngineMark } from "@/features/engine-config/EngineMark";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import {
  Button,
  ListRow,
  NavList,
  NavRow,
  notify,
  OverflowFadeText,
  SectionHeading,
} from "@/shared/ui";
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
  if (!market?.ready) return null;
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
                    loading={adding === suggestion.source}
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
