import {
  CatalogNames,
  Mark,
  SettingsRow,
  SettingsSection,
  StoreInfo,
  StoreSheet,
  StoreSheetSection,
  Text,
  type StoreFact,
} from "@misty/ui";
import type { McpEntry, PluginEntry } from "@/native/registry";

import { AppSheet } from "./ExploreApps";
import { EngineSheet } from "./ExploreEngines";
import { SpeechSheet } from "./ExploreSpeechProducts";
import { useReadyEngines } from "./explore_installs";
import { kindNames, rankText, useCategories } from "./explore_index";
import type { ExploreItem, ListingItem } from "./explore_view";
import { ListingHere } from "./ListingHere";
import { ActionButton, ListingLogo, SourceMenu, sourceLink, useListingAction } from "./ListingRows";

export function ExploreSheet({
  item,
  spaceId,
  onClose,
}: {
  item: ExploreItem;
  spaceId: string;
  onClose: () => void;
}) {
  if (item.kind === "apps") return <AppSheet spaceId={spaceId} id={item.id} onClose={onClose} />;
  if (item.kind === "engines") return <EngineSheet id={item.id} onClose={onClose} />;
  if (item.kind === "hearing") return <SpeechSheet id={item.id} onClose={onClose} />;
  return <ListingSheet item={item as ListingItem} onClose={onClose} />;
}

const kilobytes = (bytes: number) =>
  bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1).replace(/\.0$/, "")} MB`
    : `${Math.max(1, Math.round(bytes / 1000))} KB`;

const hostOf = (link: string) => {
  try {
    return new URL(link).host;
  } catch {
    return link;
  }
};

const counted = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

function insideOf(plugin: PluginEntry | null) {
  const adds = plugin?.includes;
  if (!adds) return [];
  return [
    ...(adds.skills ? [counted(adds.skills, "skill", "skills")] : []),
    ...(adds.agents ? [counted(adds.agents, "agent", "agents")] : []),
    ...(adds.commands ? [counted(adds.commands, "command", "commands")] : []),
    ...(adds.hooks ? ["Hooks"] : []),
    ...(adds.mcp ? ["1 MCP server"] : []),
  ];
}

function ListingSheet({ item, onClose }: { item: ListingItem; onClose: () => void }) {
  const categories = useCategories();
  const { entry, kind } = item;
  const { action } = useListingAction(item);
  const engines = useReadyEngines();
  const category = categories.find((one) => one.id === entry.category)?.name ?? entry.category;
  const server = kind === "mcps" ? (entry as McpEntry) : null;
  const plugin = kind === "plugins" ? (entry as PluginEntry) : null;
  const inside = insideOf(plugin);
  const marks =
    kind === "skills"
      ? engines.filter((engine) => engine.skills)
      : kind === "mcps"
        ? engines.filter((engine) => engine.mcp)
        : kind === "plugins"
          ? engines.filter((engine) => engine.plugins || engine.skills)
          : [];
  const version = server?.package?.version ?? entry.source?.commit.slice(0, 7);
  const facts: StoreFact[] = [
    ...(version ? [{ label: "Version", value: version }] : []),
    ...(entry.bundle ? [{ label: "Size", value: kilobytes(entry.bundle.size) }] : []),
    ...(entry.license ? [{ label: "License", value: entry.license }] : []),
    ...(entry.source
      ? [{ label: "Source", value: "GitHub" }]
      : server?.homepage
        ? [{ label: "Source", value: hostOf(server.homepage) }]
        : []),
    ...(entry.rank && entry.source ? [{ label: "Stars", value: rankText(entry.rank) }] : []),
  ];
  return (
    <StoreSheet
      open
      onOpenChange={(open) => !open && onClose()}
      logo={<ListingLogo entry={entry} size="sheet" />}
      title={entry.name}
      maker={entry.maker}
      action={<ActionButton action={action} size="md" label={entry.name} />}
      menu={sourceLink(entry) ? <SourceMenu entry={entry} /> : undefined}
      facts={facts}
    >
      <Text as="p" size="body" wrap className="m-0">
        {entry.description || `A ${kindNames[kind].one} by ${entry.maker}.`}
      </Text>
      {inside.length ? (
        <StoreSheetSection title="What's inside">
          <CatalogNames names={inside} />
        </StoreSheetSection>
      ) : null}
      {marks.length ? (
        <StoreSheetSection title="Works with">
          <div className="flex min-w-0 items-center gap-2">
            {marks.map((engine) => (
              <Mark key={engine.id} of={`engine:${engine.id}`} label={engine.name} size={27} />
            ))}
          </div>
        </StoreSheetSection>
      ) : null}
      {server ? <McpConnects entry={server} /> : null}
      <ListingHere item={item} />
      <StoreSheetSection title="Information">
        <StoreInfo
          items={[
            { label: "Made by", value: entry.maker },
            { label: "Category", value: category },
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
          ]}
        />
      </StoreSheetSection>
    </StoreSheet>
  );
}

function McpConnects({ entry }: { entry: McpEntry }) {
  return (
    <SettingsSection title="How it connects">
      {entry.remote ? (
        <SettingsRow
          label={`Hosted by ${entry.maker}`}
          description={`You sign in to ${entry.maker} with your own account; nothing is installed`}
        >
          <Text size="meta" tone="muted">
            {hostOf(entry.remote.url)}
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
  );
}
