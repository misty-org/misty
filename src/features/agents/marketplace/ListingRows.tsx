import { ExternalLink } from "lucide-react";
import { useState, type ReactNode } from "react";
import { openExternalLink } from "@/shared/platform/open_external_link";
import {
  Button,
  MenuItem,
  notify,
  ProgressPill,
  StoreList,
  StoreRow,
  StoreSection,
} from "@misty/ui";
import { confirmAction } from "@/shared/lib/confirm_action";
import type { EntryOf, ListingEntry, ListingKind, McpEntry, PluginEntry } from "@/native/registry";
import {
  addPackage,
  connectRemote,
  installPlugin,
  installSkill,
  makeAgentFromTemplate,
  runsHere,
  useMcpHere,
  useReadyEngines,
  useInstallRecords,
  useSkillsHere,
  useTemplateAgents,
} from "./explore_installs";
import { failureText } from "./explore_index";
import { useExploreNav, type BarAction, type ListingItem } from "./explore_view";
import { MakerTile, pluginMaker } from "./PluginMaker";

export function ListingLogo({
  entry,
  size = "item",
}: {
  entry: ListingEntry;
  size?: "item" | "sheet";
}) {
  const link = entry.source ? `https://github.com/${entry.source.repo}` : null;
  const maker = pluginMaker({ author: entry.maker, link });
  return <MakerTile maker={maker} name={entry.name} size={size} />;
}

export const sourceLink = (entry: ListingEntry) =>
  entry.source
    ? `https://github.com/${entry.source.repo}/tree/${entry.source.commit}/${entry.source.path}`
    : (entry as McpEntry).homepage;

export function useListingAction(item: ListingItem): {
  action: BarAction | null;
  has: boolean;
} {
  const nav = useExploreNav();
  const engines = useReadyEngines();
  const skills = useSkillsHere();
  const agentsFrom = useTemplateAgents();
  const mcp = useMcpHere();
  const records = useInstallRecords();
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<unknown>, failed: string, done?: () => void) => {
    setBusy(true);
    try {
      await work();
      done?.();
    } catch (reason) {
      notify({ message: failureText(reason, failed), tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  const get = (onClick: () => void): BarAction => ({
    label: "Get",
    variant: "get",
    disabled: busy,
    onClick,
  });
  const { entry } = item;
  if (item.kind === "skills") {
    if (skills.of(entry)) return { action: null, has: true };
    const targets = engines.flatMap((engine) => (engine.skills ? [engine.skills] : []));
    return {
      has: false,
      action: get(() => {
        if (!targets.length) {
          notify({
            message: "Install an engine first: skills go into each engine's own folder.",
            tone: "error",
          });
          return;
        }
        void run(
          () => installSkill(entry, targets),
          `${entry.name} couldn't be added.`,
          () => {
            void skills.reload();
            notify({
              message: `${entry.name} is in ${targets.length === 1 ? "your engine" : "your engines"}.`,
            });
          },
        );
      }),
    };
  }
  if (item.kind === "templates") {
    return {
      has: agentsFrom(entry).length > 0,
      action: {
        label: "Use",
        variant: "secondary",
        disabled: busy,
        onClick: () =>
          void run(
            () => makeAgentFromTemplate(entry),
            `${entry.name} couldn't be made into an agent.`,
            () => notify({ message: `${entry.name} is one of your agents.` }),
          ),
      },
    };
  }
  if (item.kind === "mcps") {
    const server = item.entry;
    const here = mcp.of(server);
    if (here.connection || here.configured.length) return { action: null, has: true };
    if (server.remote)
      return {
        has: false,
        action: get(
          () => void run(() => connectRemote(server), `${server.name} couldn't be connected.`),
        ),
      };
    if (!runsHere(server)) return { action: null, has: false };
    if (server.env?.length) return { has: false, action: get(() => nav.open(item)) };
    const targets = engines.filter((engine) => engine.mcp).map((engine) => engine.id);
    return {
      has: false,
      action: get(() => {
        if (!targets.length) {
          notify({
            message: "Install an engine first: MCP servers go into each engine's own settings.",
            tone: "error",
          });
          return;
        }
        void run(
          () => addPackage(server, targets, []),
          `${server.name} couldn't be added.`,
          () => mcp.reload(),
        );
      }),
    };
  }
  if (item.kind === "plugins") {
    const plugin = item.entry as PluginEntry;
    const record = records.data?.find((one) => one.kind === "plugins" && one.id === plugin.id);
    if (record && plugin.bundle && record.digest !== plugin.bundle.sha256)
      return {
        has: true,
        action: {
          label: "Update",
          variant: "get",
          disabled: busy,
          onClick: () =>
            void run(
              () => installPlugin(plugin, engines, askToRun),
              `${plugin.name} couldn't be updated.`,
              () => void records.reload(),
            ),
        },
      };
    if (record) return { action: null, has: true };
    if (!plugin.bundle) return { action: null, has: false };
    return {
      has: false,
      action: get(
        () =>
          void run(
            () => installPlugin(plugin, engines, askToRun),
            `${plugin.name} couldn't be added.`,
            () => void records.reload(),
          ),
      ),
    };
  }
  return { action: null, has: false };
}

export const askToRun = (engine: string, command: string) =>
  confirmAction(
    `${engine} asks to run this when the plugin is added: ${command}`,
    `Let ${engine} run this?`,
  );

const actionLabels = ["Get", "Update", "Open", "Use", "Sign in", "Remove"];

export function ActionButton({
  action,
  size = "sm",
  label,
}: {
  action: BarAction | null;
  size?: "sm" | "md";
  label?: string;
}) {
  if (!action) return null;
  if (action.progress)
    return (
      <ProgressPill
        value={action.progress.value}
        label={label ? `Downloading ${label}` : "Downloading"}
        size={size}
        widthOf={actionLabels}
      />
    );
  return (
    <Button
      variant={action.variant}
      size={size}
      disabled={action.disabled}
      widthOf={actionLabels}
      onClick={(event) => {
        event.stopPropagation();
        action.onClick();
      }}
    >
      {action.label}
    </Button>
  );
}

export function SourceMenu({ entry }: { entry: ListingEntry }) {
  const link = sourceLink(entry);
  if (!link) return null;
  return (
    <MenuItem
      icon={ExternalLink}
      label="Open its source"
      onSelect={() => void openExternalLink(link)}
    />
  );
}

export function ListingItem<K extends ListingKind>({
  kind,
  entry,
}: {
  kind: K;
  entry: EntryOf<K>;
}) {
  const nav = useExploreNav();
  const item = { kind, entry } as ListingItem;
  const { action } = useListingAction(item);
  return (
    <StoreRow
      logo={<ListingLogo entry={entry} />}
      title={entry.name}
      line={entry.description || undefined}
      maker={entry.maker}
      action={<ActionButton action={action} label={entry.name} />}
      menu={sourceLink(entry) ? <SourceMenu entry={entry} /> : undefined}
      onOpen={() => nav.open(item)}
    />
  );
}

export function ListingShelf<K extends ListingKind>({
  title,
  kind,
  items,
  onSeeAll,
}: {
  title: string;
  kind: K;
  items: readonly EntryOf<K>[];
  onSeeAll?: () => void;
}) {
  if (!items.length) return null;
  return (
    <StoreSection title={title} action={onSeeAll ? <SeeAll onClick={onSeeAll} /> : undefined}>
      <StoreList label={title}>
        {items.map((entry) => (
          <ListingItem key={entry.id} kind={kind} entry={entry} />
        ))}
      </StoreList>
    </StoreSection>
  );
}

export function SeeAll({ onClick }: { onClick: () => void }): ReactNode {
  return (
    <Button variant="quiet" size="sm" onClick={onClick}>
      See all
    </Button>
  );
}
