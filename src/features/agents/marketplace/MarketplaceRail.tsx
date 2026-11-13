import { FolderGit2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { EngineMark } from "@/features/engine-config/EngineMark";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import { Button, notify, Pressable, SectionHeading, Surface, Text } from "@/shared/ui";
import { failureText, marketApi, unaddedSuggestions, type MarketEngine } from "./api";
import { MakerLogo, pluginMaker } from "./pluginMaker";
import { useEngineMarket } from "./useEngineMarket";

const rowClass = "flex h-8 w-full min-w-0 items-center gap-2.5 rounded-lg px-2 text-left";

/** One row of the rail: the picked one is filled, the rest wash under the pointer. */
function RailRow({
  current,
  icon,
  label,
  end,
  onClick,
}: {
  current: boolean;
  icon: ReactNode;
  label: string;
  end?: ReactNode;
  onClick(): void;
}) {
  const content = (
    <>
      {icon}
      <Text tone={current ? "bright" : "default"} className="min-w-0 flex-1">
        {label}
      </Text>
      {end}
    </>
  );
  return current ? (
    <Surface
      as={Pressable}
      tone="well"
      radius="lg"
      aria-current="page"
      className={rowClass}
      onClick={onClick}
    >
      {content}
    </Surface>
  ) : (
    <Pressable wash="row" className={rowClass} onClick={onClick}>
      {content}
    </Pressable>
  );
}

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
    <section className="grid gap-0.5" aria-label="Engines">
      <SectionHeading title="Engine" as="h3" />
      {engines.map((entry) => (
        <RailRow
          key={entry.id}
          current={entry.id === engine}
          icon={<EngineMark engine={entry.id} name={entry.name} size={18} />}
          label={entry.name}
          onClick={() => onPick(entry.id)}
        />
      ))}
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
    <section className="grid gap-0.5" aria-label="Marketplaces">
      <SectionHeading
        title="Marketplaces"
        as="h3"
        count={market.sources.length}
        action={{ label: "Manage marketplaces", icon: FolderGit2, onSelect: onManage }}
      />
      {market.sources.map((source) => {
        const link = githubLink(source.location);
        return (
          <RailRow
            key={source.name}
            current={false}
            icon={<MakerLogo maker={pluginMaker({ link })} name={source.name} size="sm" />}
            label={source.name}
            onClick={() => (link ? openExternalLink(link) : onManage())}
          />
        );
      })}
      {suggestions.length ? (
        <div className="grid gap-1 pt-3">
          <Text size="caption" tone="muted" className="px-2">
            Suggested
          </Text>
          <ul className="m-0 grid list-none gap-0.5 p-0">
            {suggestions.map((suggestion) => {
              const link = `https://github.com/${suggestion.source}`;
              return (
                <li key={suggestion.source} className="flex min-w-0 items-center gap-2.5 px-2 py-1">
                  <MakerLogo maker={pluginMaker({ link })} name={suggestion.name} size="sm" />
                  <div className="grid min-w-0 flex-1">
                    <Text tone="default">{suggestion.name}</Text>
                    <Text size="caption" tone="muted" full>
                      {suggestion.line}
                    </Text>
                  </div>
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
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
