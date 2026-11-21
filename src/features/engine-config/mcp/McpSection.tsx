// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

/**
 * Explore › Connectors: each engine's own MCP servers, as store shelves.
 *
 * Every engine Misty can run has a chip, whether or not it has MCP. Its shelves keep the two
 * lists apart: what the CLI's files declare ("Added", with on/off only for sources whose writes
 * were verified) and what a live session really connected ("At runtime", per folder and session,
 * with when it was collected). Engines that carry MCP through plugins say so; engines without MCP
 * say so instead of showing an empty list as if nothing were configured. A runtime Misty can't
 * query says that in its shelf's heading rather than pretending there are no servers. Misty's own
 * server is listed by the session but never offered for editing.
 */
import { Activity, Info, Plus, Power, PowerOff, FolderOpen, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EngineMark } from "../EngineMark";
import { folderName } from "../host";
import {
  Button,
  CatalogDone,
  CollectionFilters,
  EmptyState,
  ErrorState,
  IconButton,
  MenuItem,
  MenuSeparator,
  notify,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Shelf,
  ShelfItem,
  ShelfSkeleton,
  StoreDetail,
  StoreDetailSection,
  Text,
  Tooltip,
  type StoreFact,
} from "@misty/ui";
import { AddServerDialog, enginesThatAdd } from "./AddServerDialog";
import { mcpApi } from "./api";
import { EngineNotices, McpSourceHint } from "./McpNotices";
import { ConnectorLogo, connectorLine, McpDetailDialog } from "./McpDetailDialog";
import { McpProbeConfirmHost } from "./McpProbeConfirmHost";
import { useMcpFolder } from "./useMcpFolder";
import { copy, engineLabel, readonlyReasonText, runtimeStatusText } from "./copy";
import { probeable, useAutoProbe, useMcpProbeStore } from "./probe-store";
import { ProbeStatusChip } from "./ProbeControls";
import type { McpConfigEntry, McpEngineId, McpRuntimeEntry, McpRuntimeSection } from "./types";
import { useMcpInventory } from "./useMcpInventory";

const NO_FOLDER = "__none__";

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

const failureText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function FolderChoice({
  folders,
  value,
  onChange,
}: {
  folders: string[];
  value: string | null;
  onChange: (folder: string | null) => void;
}) {
  return (
    <Select
      value={value ?? NO_FOLDER}
      onValueChange={(next) => onChange(next === NO_FOLDER ? null : next)}
    >
      <SelectTrigger aria-label={copy.folder} className="w-50 max-w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_FOLDER} label={copy.folderNone} />
        {folders.map((folder) => (
          <SelectItem key={folder} value={folder} label={folderName(folder)} />
        ))}
      </SelectContent>
    </Select>
  );
}

/** A configured server's one action: on is done, off turns on, a read-only off just says so. */
function ConfigAction({
  entry,
  pending,
  onToggle,
}: {
  entry: McpConfigEntry;
  pending: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <>
      {entry.enabled ? (
        <CatalogDone label="On" />
      ) : entry.writable ? (
        <Button variant="get" size="sm" disabled={pending} onClick={() => onToggle(true)}>
          Turn on
        </Button>
      ) : (
        <Tooltip content={readonlyReasonText(entry)}>
          <Text size="meta" tone="muted" tabIndex={0}>
            {copy.disabled}
          </Text>
        </Tooltip>
      )}
      <ProbeStatusChip entry={entry} />
    </>
  );
}

/** A configured server's ⋯: details, on/off, a check and where its file is. */
function ConfigMenu({
  entry,
  pending,
  workspacePath,
  onOpen,
  onToggle,
}: {
  entry: McpConfigEntry;
  pending: boolean;
  workspacePath: string | null;
  onOpen: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const probe = useMcpProbeStore((state) => state.probe);
  const probing = useMcpProbeStore((state) => Boolean(state.pending[entry.id]));
  return (
    <>
      <MenuItem icon={Info} label="Details" onSelect={onOpen} />
      <MenuItem
        icon={entry.enabled ? PowerOff : Power}
        label={entry.enabled ? "Turn off" : "Turn on"}
        disabled={pending || !entry.writable}
        reason={entry.writable ? undefined : readonlyReasonText(entry)}
        onSelect={() => onToggle(!entry.enabled)}
      />
      {probeable(entry) ? (
        <MenuItem
          icon={Activity}
          label={copy.probeCheckLabel}
          disabled={probing}
          onSelect={() => void probe(entry, workspacePath)}
        />
      ) : null}
      <MenuSeparator />
      <MenuItem
        icon={FolderOpen}
        label={copy.reveal}
        onSelect={() =>
          void mcpApi
            .reveal(entry.path, workspacePath)
            .catch((error: unknown) => notify({ message: failureText(error), tone: "error" }))
        }
      />
    </>
  );
}

/** What a session said about its servers, in one line for the runtime shelf's heading. */
function runtimeStatus(section: McpRuntimeSection): string {
  const ready = section.status === "ready" || section.status === "session_ended";
  if (!ready) return section.reason ?? runtimeStatusText[section.status];
  const base = section.entries.length === 0 ? copy.runtimeEmpty : runtimeStatusText[section.status];
  const when = [
    section.sessionId ? `from ${copy.runtimeSession(section.sessionId)}` : null,
    section.collectedAt
      ? copy.runtimeCollectedAt(timeFormat.format(new Date(section.collectedAt)))
      : null,
  ]
    .filter(Boolean)
    .join(" ");
  return when ? `${base.replace(/\.$/, "")}, read ${when}` : base;
}

/** A runtime server's one line: Misty's own, then its tools or its status. */
function runtimeLine(entry: McpRuntimeEntry): string {
  if (entry.toolNames.length > 0) {
    const tools = copy.runtimeTools(entry.toolNames.length);
    return entry.builtin ? `${tools} from ${copy.builtin}` : tools;
  }
  const status = entry.status ?? copy.runtimeStatusUnknown;
  return entry.builtin ? `${status}, from ${copy.builtin}` : status;
}

/** A server a session reported, in detail: its counts and the names of its tools. */
function RuntimeDetail({ entry, onClose }: { entry: McpRuntimeEntry; onClose: () => void }) {
  const facts: StoreFact[] = [
    { label: "Tools", value: String(entry.toolNames.length) },
    { label: "Resources", value: String(entry.resourcesCount) },
    { label: "Templates", value: String(entry.templatesCount) },
  ];
  return (
    <StoreDetail
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      logo={<ConnectorLogo name={entry.name} />}
      title={entry.name}
      line={runtimeLine(entry)}
      facts={facts}
    >
      {entry.toolNames.length > 0 ? (
        <StoreDetailSection title="Tools">
          <ul className="m-0 grid list-none gap-1 p-0 sm:grid-cols-2">
            {entry.toolNames.map((tool) => (
              <li key={tool} className="min-w-0">
                <Text tone="default" full>
                  {tool}
                </Text>
              </li>
            ))}
          </ul>
        </StoreDetailSection>
      ) : null}
    </StoreDetail>
  );
}

/**
 * The Connectors section. `query` is the Explore rail's search text; the rail owns the field, so
 * the section draws none of its own.
 */
export function McpSection({ query = "" }: { query?: string } = {}) {
  const [folders, workspace, setWorkspace] = useMcpFolder();
  const store = useMcpInventory(workspace);
  const [engineId, setEngineId] = useState<McpEngineId>("claude");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runtimeName, setRuntimeName] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const probeAll = useMcpProbeStore((state) => state.probeAll);
  const probingAll = useMcpProbeStore((state) => state.runningAll);
  const probeError = useMcpProbeStore((state) => state.error);

  // Reloads replace the inventory; memoizing the engines keeps the `engine` lookup (and all that
  // follows from it) stable between renders that don't change it.
  const engines = useMemo(() => store.inventory?.engines ?? [], [store.inventory]);
  const engine = useMemo(
    () => engines.find((item) => item.id === engineId) ?? engines[0] ?? null,
    [engines, engineId],
  );
  // The details follow the list as read back, so after a switch they show what's really in the file.
  const selected = useMemo(
    () => engine?.config.entries.find((entry) => entry.id === selectedId) ?? null,
    [engine, selectedId],
  );
  const runtimeSelected = useMemo(
    () => engine?.runtime.entries.find((entry) => entry.name === runtimeName) ?? null,
    [engine, runtimeName],
  );
  // Check on open (fresh results are reused; a changed config fills in only what's missing).
  useAutoProbe(engine?.config.entries, workspace);

  useEffect(() => {
    if (probeError) notify({ message: probeError, tone: "error", id: "mcp-probe" });
  }, [probeError]);

  const needle = query.trim().toLowerCase();
  const matches = (name: string) => !needle || name.toLowerCase().includes(needle);
  const configEntries = (engine?.config.entries ?? []).filter((entry) => matches(entry.name));
  const runtimeEntries = (engine?.runtime.entries ?? []).filter((entry) => matches(entry.name));
  const noEntries = (engine?.config.entries.length ?? 0) === 0;
  const probeableCount = (engine?.config.entries ?? []).filter(probeable).length;

  const handleToggle = (entry: McpConfigEntry, enabled: boolean) => {
    void store
      .setEnabled(entry, enabled)
      .catch((error: unknown) => notify({ message: failureText(error), tone: "error" }));
  };
  const handleRefresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    void store.reload().finally(() => setRefreshing(false));
  };

  // Only a failed first read replaces the shelves; a failed write or refresh keeps them.
  const loadError =
    !store.inventory && store.error
      ? typeof store.error === "string"
        ? store.error
        : store.error.message
      : null;

  const controls = (
    <CollectionFilters
      value={engine?.id ?? ""}
      onChange={(id) => {
        setEngineId(id as McpEngineId);
        setSelectedId(null);
        setRuntimeName(null);
      }}
      options={engines.map((item) => ({
        value: item.id,
        label: engineLabel(item.id),
        icon: <EngineMark engine={item.id} />,
      }))}
      utilities={
        folders.length > 0 ? (
          <FolderChoice folders={folders} value={workspace} onChange={setWorkspace} />
        ) : undefined
      }
      actions={
        <div className="flex items-center gap-1">
          <Tooltip content={copy.probeHint}>
            <Button
              icon={Activity}
              disabled={store.loading || probingAll || probeableCount === 0}
              onClick={() =>
                void probeAll(engine?.config.entries ?? [], workspace, { force: true })
              }
            >
              {copy.probeCheckAll}
            </Button>
          </Tooltip>
          <IconButton
            label={copy.refresh}
            disabled={store.loading || refreshing}
            onClick={handleRefresh}
          >
            <RefreshCw />
          </IconButton>
          {engine && enginesThatAdd.includes(engine.id) ? (
            <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
              Add server
            </Button>
          ) : null}
        </div>
      }
    />
  );

  const body = () => {
    if (loadError) {
      return (
        <ErrorState
          inline
          title="Connectors couldn't load"
          line={loadError}
          action={{ label: "Try again", variant: "secondary", onClick: () => void store.reload() }}
        />
      );
    }
    if (store.loading || !engine) {
      return (
        <>
          <ShelfSkeleton label="Added" />
          <ShelfSkeleton label={copy.runtimeTitle} items={2} />
        </>
      );
    }
    if (engine.support === "none") return <EngineNotices engine={engine} />;
    if (needle && configEntries.length === 0 && runtimeEntries.length === 0) {
      return (
        <>
          <EngineNotices engine={engine} />
          <EmptyState inline title="No connectors found" line="Try another word." />
        </>
      );
    }
    return (
      <>
        <EngineNotices engine={engine} />
        {configEntries.length > 0 ? (
          <Shelf title="Added">
            {configEntries.map((entry) => {
              const pending = store.pendingId === entry.id;
              return (
                <ShelfItem
                  key={entry.id}
                  logo={<ConnectorLogo name={entry.name} />}
                  title={entry.name}
                  line={connectorLine(entry)}
                  action={
                    <ConfigAction
                      entry={entry}
                      pending={pending}
                      onToggle={(enabled) => handleToggle(entry, enabled)}
                    />
                  }
                  menu={
                    <ConfigMenu
                      entry={entry}
                      pending={pending}
                      workspacePath={workspace}
                      onOpen={() => setSelectedId(entry.id)}
                      onToggle={(enabled) => handleToggle(entry, enabled)}
                    />
                  }
                  onOpen={() => setSelectedId(entry.id)}
                />
              );
            })}
          </Shelf>
        ) : noEntries ? (
          <>
            <EmptyState
              inline
              title="No servers added"
              line={`${engineLabel(engine.id)} has none in its config.`}
            />
            <McpSourceHint sources={engine.sources} workspacePath={workspace} />
          </>
        ) : null}
        {needle && runtimeEntries.length === 0 ? null : (
          <Shelf
            title={copy.runtimeTitle}
            action={
              <Text size="meta" tone="muted" full>
                {runtimeStatus(engine.runtime)}
              </Text>
            }
          >
            {runtimeEntries.map((entry) => (
              <ShelfItem
                key={entry.name}
                logo={<ConnectorLogo name={entry.name} />}
                title={entry.name}
                line={runtimeLine(entry)}
                onOpen={() => setRuntimeName(entry.name)}
              />
            ))}
          </Shelf>
        )}
      </>
    );
  };

  return (
    <>
      {controls}
      {body()}
      {selected ? (
        <McpDetailDialog
          entry={selected}
          pending={store.pendingId === selected.id}
          workspacePath={workspace}
          onToggle={(enabled) => handleToggle(selected, enabled)}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
      {runtimeSelected ? (
        <RuntimeDetail entry={runtimeSelected} onClose={() => setRuntimeName(null)} />
      ) : null}
      {engine && enginesThatAdd.includes(engine.id) ? (
        <AddServerDialog
          engine={engine.id}
          open={adding}
          onOpenChange={setAdding}
          onAdded={handleRefresh}
        />
      ) : null}
      <McpProbeConfirmHost />
    </>
  );
}
