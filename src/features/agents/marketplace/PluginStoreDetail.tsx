import { Download, ExternalLink, Power, Trash2 } from "lucide-react";
import { useCachedResource } from "@/api/cache/cached-resource";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import {
  Button,
  CatalogDone,
  CatalogNames,
  MenuItem,
  InlineLink,
  PropertyList,
  Skeleton,
  StoreDetail,
  StoreDetailSection,
  Text,
  type StoreFact,
} from "@misty/ui";
import {
  canTurnOff,
  categoryLabel,
  marketApi,
  type MarketEngine,
  type MarketItem,
  type PluginContents,
} from "./api";
import { MakerTile, pluginMaker, sourceLabel } from "./PluginMaker";

const kinds: { key: keyof Omit<PluginContents, "known" | "version">; title: string }[] = [
  { key: "skills", title: "Skills" },
  { key: "commands", title: "Commands" },
  { key: "agents", title: "Agents" },
  { key: "hooks", title: "Hooks" },
  { key: "mcpServers", title: "MCP servers" },
];

const compact = new Intl.NumberFormat(undefined, { notation: "compact" });

/**
 * One plugin up close, as a store page: its maker's logo, name and the one thing to do with it
 * (Install, or for an installed one, turn it on or off and Remove), its facts, what it does and
 * what it adds to the engine (its skills, commands, agents, hooks and MCP servers, read from its
 * folder), and where it comes from.
 */
export function PluginStoreDetail({
  engine,
  engineName,
  item,
  busy,
  onClose,
  onInstall,
  onRemove,
  onEnabledChange,
}: {
  engine: MarketEngine;
  engineName: string;
  /** The plugin shown; null closes it. */
  item: MarketItem | null;
  /** The plugin being installed or changed, if any. */
  busy: string | null;
  onClose(): void;
  onInstall(item: MarketItem): void;
  onRemove(item: MarketItem): void;
  onEnabledChange(item: MarketItem, enabled: boolean): void;
}) {
  // Read once per plugin and kept for the session: a plugin's folder changes only when it updates.
  const contents = useCachedResource(
    item ? `engines/market-details:${engine}:${item.id}:${item.installed}` : null,
    () => marketApi.details(engine, item?.id ?? ""),
  );
  if (!item) return null;
  const maker = pluginMaker(item);
  const link = item.link;
  const found = contents.data;
  const added = found ? kinds.filter((kind) => found[kind.key].length) : [];
  const facts: StoreFact[] = [
    ...(maker.name ? [{ label: "Maker", value: maker.name }] : []),
    { label: "Marketplace", value: item.marketplace },
    ...(found?.version ? [{ label: "Version", value: found.version }] : []),
    ...(item.installs
      ? [{ label: "Installs", value: compact.format(item.installs) }]
      : item.stars
        ? [{ label: "Stars", value: compact.format(item.stars) }]
        : []),
    ...(item.category ? [{ label: "Category", value: categoryLabel(item.category) }] : []),
  ];

  return (
    <StoreDetail
      open
      onOpenChange={(open) => !open && onClose()}
      logo={<MakerTile maker={maker} name={item.name} />}
      title={item.name}
      line={item.installed && !item.enabled ? "Off · kept installed" : (maker.name ?? undefined)}
      action={
        item.installed ? (
          canTurnOff(engine) && !item.enabled ? (
            <Button
              variant="get-filled"
              icon={Power}
              disabled={busy !== null}
              onClick={() => onEnabledChange(item, true)}
            >
              Turn on
            </Button>
          ) : (
            <CatalogDone />
          )
        ) : (
          <Button
            variant="get-filled"
            icon={Download}
            disabled={busy !== null}
            onClick={() => onInstall(item)}
          >
            {item.signIn === "on_install"
              ? `Install in ${engineName} and sign in`
              : `Install in ${engineName}`}
          </Button>
        )
      }
      menu={
        item.installed || link ? (
          <>
            {link ? (
              <MenuItem icon={ExternalLink} label="Open its page" onSelect={() => openExternalLink(link)} />
            ) : null}
            {item.installed && canTurnOff(engine) && item.enabled ? (
              <MenuItem
                icon={Power}
                label="Turn off"
                disabled={busy !== null}
                onSelect={() => onEnabledChange(item, false)}
              />
            ) : null}
            {item.installed ? (
              <MenuItem
                icon={Trash2}
                label="Remove"
                danger
                disabled={busy !== null}
                onSelect={() => onRemove(item)}
              />
            ) : null}
          </>
        ) : undefined
      }
      facts={facts}
    >
      <StoreDetailSection title="About">
        {item.description ? (
          <Text as="p" size="body" tone="default" wrap className="m-0">
            {item.description}
          </Text>
        ) : null}
        {link ? (
          <PropertyList
            label="Where it comes from"
            items={[
              {
                label: "Source",
                value: (
                  <InlineLink onClick={() => openExternalLink(link)}>
                    {sourceLabel(link)}
                  </InlineLink>
                ),
                full: sourceLabel(link),
              },
            ]}
          />
        ) : null}
      </StoreDetailSection>

      <StoreDetailSection title={`What it adds to ${engineName}`}>
        {contents.loading ? (
          <div aria-hidden="true" className="grid gap-2">
            <Skeleton className="h-6 w-3/4 rounded-md" />
            <Skeleton className="h-6 w-1/2 rounded-md" />
          </div>
        ) : !found?.known ? (
          <Text as="p" size="meta" tone="muted" wrap className="m-0">
            {engine === "claude"
              ? "Its skills, commands and servers show here once it's installed."
              : `${engineName} doesn't list what its plugins add.`}
          </Text>
        ) : added.length === 0 ? (
          <Text as="p" size="meta" tone="muted" wrap className="m-0">
            It adds no skills, commands, agents, hooks or servers of its own.
          </Text>
        ) : (
          <dl className="m-0 grid gap-3">
            {added.map((kind) => (
              <div key={kind.key} className="grid gap-1.5">
                <Text as="dt" size="meta" tone="muted">
                  {kind.title} · {found[kind.key].length}
                </Text>
                <dd className="m-0">
                  <CatalogNames names={found[kind.key]} />
                </dd>
              </div>
            ))}
          </dl>
        )}
        {found?.hooks.length ? (
          <Text as="p" size="meta" tone="muted" wrap className="m-0">
            Hooks run on their own, without asking, with {engineName}'s permissions. Install plugins
            only from people you trust.
          </Text>
        ) : null}
      </StoreDetailSection>
    </StoreDetail>
  );
}
