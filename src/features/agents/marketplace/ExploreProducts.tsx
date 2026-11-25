import { Cable, ExternalLink, ScrollText, SquareSlash, Users, Webhook } from "lucide-react";

import { openExternalLink } from "@/shared/platform/open_external_link";

import {
  Mark,
  MenuItem,
  ProductInfo,
  ProductPage,
  ProductSection,
  ProductTile,
  ProductTiles,
  SettingsRow,
  SettingsSection,
  Text,
  type ProductFact,
} from "@misty/ui";
import type { EntryOf, ListingEntry, McpEntry, PluginEntry } from "@/native/registry";

import { AppProduct } from "./ExploreApps";
import { EngineProduct } from "./ExploreEngines";
import { SpeechProduct } from "./ExploreSpeechProducts";
import { useReadyEngines } from "./explore_installs";
import { kindNames, rankText, sorted, useCategories, useCategoryShard } from "./explore_index";
import {
  useBarAction,
  useExploreNav,
  type BarAction,
  type ExploreItem,
  type ListingItem,
} from "./explore_view";

import {
  ActionButton,
  ListingLogo,
  ListingShelf,
  sourceLink,
  useListingAction,
} from "./ListingRows";

export function ExploreProduct({
  item,
  spaceId,
}: {
  item: ExploreItem;
  spaceId: string;
}) {
  if (item.kind === "apps") return <AppProduct spaceId={spaceId} id={item.id} />;
  if (item.kind === "engines") return <EngineProduct id={item.id} />;
  if (item.kind === "hearing") return <SpeechProduct id={item.id} />;
  return <ListingProduct item={item as ListingItem} />;
}

function ListingProduct({ item }: { item: ListingItem }) {
  const nav = useExploreNav();
  const categories = useCategories();
  const { entry, kind } = item;
  const listed = useListingAction(item);
  const action: BarAction | null = listed.action;
  useBarAction(action, entry.name);
  const shard = useCategoryShard(kind, entry.category);
  const kin = (shard.data?.items ?? []) as ListingEntry[];
  const more = sorted(
    kin.filter((one) => one.maker === entry.maker && one.id !== entry.id),
    "popular",
  ).slice(0, 6);
  const like = sorted(
    kin.filter((one) => one.maker !== entry.maker),
    "popular",
  ).slice(0, 6);
  const category = categories.find((one) => one.id === entry.category)?.name ?? entry.category;
  const link = sourceLink(entry);
  const engines = useReadyEngines();
  const server = kind === "mcps" ? (entry as McpEntry) : null;
  const plugin = kind === "plugins" ? (entry as PluginEntry) : null;
  const marks =
    kind === "skills"
      ? engines.filter((engine) => engine.skills)
      : kind === "mcps"
        ? engines.filter((engine) => engine.mcp)
        : kind === "plugins"
          ? engines.filter((engine) => engine.plugins || engine.skills)
          : [];

  const facts: ProductFact[] = [
    ...(entry.rank && entry.source
      ? [{ label: "Stars", value: rankText(entry.rank), detail: "On GitHub" }]
      : []),
    { label: "Category", value: category },
    { label: "Made by", value: entry.maker },
    ...(plugin?.includes
      ? [
          {
            label: "Adds",
            value: String(
              plugin.includes.skills + plugin.includes.agents + plugin.includes.commands,
            ),
            detail: "Skills, agents, commands",
          },
        ]
      : []),
    ...(server
      ? [
          {
            label: "Connects",
            value: server.remote ? "Hosted" : "Locally",
            detail: server.remote ? "You sign in" : "Runs on this computer",
          },
        ]
      : []),
    ...(entry.license ? [{ label: "License", value: entry.license }] : []),
    ...(marks.length
      ? [
          {
            label: "Works with",
            value: (
              <>
                {marks.slice(0, 3).map((engine) => (
                  <Mark key={engine.id} of={`engine:${engine.id}`} label={engine.name} size={22} />
                ))}
              </>
            ),
            detail: marks.length === 1 ? "1 engine" : `${marks.length} engines`,
          },
        ]
      : []),
  ];

  return (
    <ProductPage
      logo={<ListingLogo entry={entry} size="hero" />}
      title={entry.name}
      line={entry.description}
      maker={entry.maker}
      onMaker={
        entry.source
          ? () => void openExternalLink(`https://github.com/${entry.source?.repo.split("/")[0]}`)
          : undefined
      }
      action={<ActionButton action={action} size="md" />}
      menu={
        link ? (
          <MenuItem
            icon={ExternalLink}
            label="Open its source"
            onSelect={() => void openExternalLink(link)}
          />
        ) : undefined
      }
      onHeroOut={nav.setPinned}
      facts={facts}
    >
      <ProductSection title="About">
        <Text as="p" size="body" wrap className="m-0 max-w-180">
          {entry.description || `A ${kindNames[kind].one} by ${entry.maker}.`}
        </Text>
      </ProductSection>
      {plugin?.includes ? (
        <ProductSection title="What's inside">
          <ProductTiles>
            <ProductTile icon={ScrollText} value={plugin.includes.skills} label="Skills" />
            <ProductTile icon={Users} value={plugin.includes.agents} label="Agents" />
            <ProductTile icon={SquareSlash} value={plugin.includes.commands} label="Commands" />
            <ProductTile
              icon={Webhook}
              value={plugin.includes.hooks ? "Yes" : "No"}
              label="Hooks"
            />
            <ProductTile
              icon={Cable}
              value={plugin.includes.mcp ? "Yes" : "No"}
              label="MCP server"
            />
          </ProductTiles>
        </ProductSection>
      ) : null}
      {server ? <McpConnects entry={server} /> : null}
      <ProductSection title="Information">
        <ProductInfo
          items={[
            { label: "Made by", value: entry.maker },
            { label: "Category", value: category },
            ...(entry.license ? [{ label: "License", value: entry.license }] : []),
            ...(entry.source ? [{ label: "Source", value: entry.source.repo }] : []),
            ...(entry.source && entry.source.path !== "."
              ? [{ label: "Folder", value: entry.source.path }]
              : []),
            ...(entry.source
              ? [{ label: "Pinned at", value: `Commit ${entry.source.commit.slice(0, 7)}` }]
              : []),
            ...(entry.also?.length
              ? [
                  {
                    label: "Also listed in",
                    value: `${entry.also.length} other ${entry.also.length === 1 ? "place" : "places"}`,
                  },
                ]
              : []),
            ...(server?.homepage ? [{ label: "Website", value: server.homepage }] : []),
            ...(server?.registry
              ? [{ label: "In the MCP registry", value: server.registry.name }]
              : []),
            ...(entry.rank && entry.source
              ? [{ label: "Stars", value: entry.rank.toLocaleString() }]
              : []),
          ]}
        />
      </ProductSection>
      <ListingShelf
        title={`More from ${entry.maker}`}
        kind={kind}
        items={more as EntryOf<typeof kind>[]}
      />
      <ListingShelf
        title="You might also like"
        kind={kind}
        items={like as EntryOf<typeof kind>[]}
      />
    </ProductPage>
  );
}

function McpConnects({ entry }: { entry: McpEntry }) {
  return (
    <ProductSection title="How it connects">
      <SettingsSection>
        {entry.remote ? (
          <SettingsRow
            label={`Hosted by ${entry.maker}`}
            description={`You sign in to ${entry.maker} with your own account; nothing is installed`}
          >
            <Text size="meta" tone="muted">
              {new URL(entry.remote.url).host}
            </Text>
          </SettingsRow>
        ) : null}
        {entry.package ? (
          <SettingsRow
            label="Runs on this computer"
            description={`From the ${entry.package.type} package ${entry.package.identifier}`}
          >
            <Text size="meta" tone="muted">
              {entry.package.version}
            </Text>
          </SettingsRow>
        ) : null}
        {(entry.env ?? []).map((one) => (
          <SettingsRow
            key={one.name}
            label={one.name}
            description={one.secret ? "A key it asks for once" : "Asked when you add it"}
          >
            <Text size="meta" tone="muted">
              {one.required ? "Needed" : "Optional"}
            </Text>
          </SettingsRow>
        ))}
      </SettingsSection>
    </ProductSection>
  );
}
