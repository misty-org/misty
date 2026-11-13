// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

/**
 * Settings › Tools › MCP servers: each engine's own MCP servers.
 *
 * Every engine Misty can run has an entry, whether or not it has MCP: the configured list (what
 * the CLI's files declare, with on/off switches only for sources whose writes were verified) and
 * the runtime list (what a live session really connected, per folder and session, with when it
 * was collected). Engines that carry MCP through plugins say so; engines without MCP say so
 * instead of showing an empty list as if nothing were configured. A runtime Misty can't query
 * says that rather than pretending there are no servers. Misty's own server is listed by the
 * session but never offered for editing.
 */
import { Activity, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { EngineMark } from "../EngineMark";
import { folderName } from "../host";
import { DesktopSettingsNotice, DesktopSettingsSection as Section } from "@/features/settings";
import {
  Badge,
  Button,
  ChoiceGroup,
  cn,
  Pressable,
  SearchField,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  SkeletonControl,
  Surface,
  Text,
  Tooltip,
} from "@/shared/ui";
import { EngineNotices, McpSourceHint } from "./McpNotices";
import { McpDetailDialog } from "./McpDetailDialog";
import { McpProbeConfirmHost } from "./McpProbeConfirmHost";
import { useMcpFolder } from "./useMcpFolder";
import { copy, engineLabel, runtimeStatusText, sourceLabel } from "./copy";
import { EnableToggle } from "./EnableToggle";
import { latestCheckedAt, probeable, useAutoProbe, useMcpProbeStore } from "./probe-store";
import { ProbeActionButton, ProbeStatusChip } from "./ProbeControls";
import type {
  McpConfigEntry,
  McpEngineId,
  McpEngineInventory,
  McpRuntimeEntry,
  McpRuntimeSection,
} from "./types";
import { useMcpInventory } from "./useMcpInventory";

type KindFilter = "all" | "config" | "runtime";

const NO_FOLDER = "__none__";

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

function ConfigRow({
  entry,
  pending,
  selected,
  workspacePath,
  onOpen,
  onToggle,
}: {
  entry: McpConfigEntry;
  pending: boolean;
  selected: boolean;
  workspacePath: string | null;
  onOpen: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const meta = entry.command
    ? `${entry.command}${entry.argsCount > 0 ? ` +${entry.argsCount}` : ""}`
    : (entry.url ?? copy.transportUnknown);
  return (
    <Surface
      as="li"
      tone={selected ? "well" : "none"}
      className={cn("flex min-h-14 items-center gap-2 py-2", pending && "opacity-60")}
    >
      <Pressable
        onClick={onOpen}
        aria-label={copy.rowOpen(entry.name)}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md"
      >
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <Text full size="body" weight="medium" tone="bright">
              {entry.name}
            </Text>
            <Badge variant="secondary">{sourceLabel(entry.source)}</Badge>
            {!entry.enabled ? <Badge variant="secondary">{copy.disabled}</Badge> : null}
          </span>
          <Text full tone="muted" className="text-sm">
            {entry.transport ? `${entry.transport} · ` : ""}
            {meta}
          </Text>
        </span>
        {/* The badge is still inside the button, so clicking it opens the details too. */}
        <ProbeStatusChip entry={entry} />
      </Pressable>
      {probeable(entry) ? <ProbeActionButton entry={entry} workspacePath={workspacePath} /> : null}
      <EnableToggle entry={entry} pending={pending} onChange={onToggle} />
    </Surface>
  );
}

/**
 * The configured list's first read: rows shaped like ConfigRow, a name with its source badge over
 * the command line, then the check's chip, the check button and the on/off switch.
 */
function ConfigRowsSkeleton() {
  const widths = ["w-28", "w-36", "w-24"];
  return (
    <ul role="status" aria-label="MCP servers" aria-busy="true" className="divide-y">
      {widths.map((width) => (
        <li key={width} aria-hidden="true" className="flex min-h-14 items-center gap-2 py-2">
          <span className="grid min-w-0 flex-1 gap-0.5">
            <span className="flex h-5.5 min-w-0 items-center gap-2">
              <Skeleton className={cn("h-4", width)} />
              <SkeletonControl kind="badge" />
            </span>
            <span className="flex h-5 items-center">
              <Skeleton className="h-3.5 w-1/2" />
            </span>
          </span>
          <SkeletonControl kind="badge" />
          <SkeletonControl kind="icon" />
          <SkeletonControl kind="icon" />
        </li>
      ))}
    </ul>
  );
}

/** One engine's configured servers. */
function McpConfigList({
  entries,
  pendingId,
  selectedId,
  workspacePath,
  onOpen,
  onToggle,
}: {
  entries: McpConfigEntry[];
  pendingId: string | null;
  selectedId: string | null;
  workspacePath: string | null;
  onOpen: (entry: McpConfigEntry) => void;
  onToggle: (entry: McpConfigEntry, enabled: boolean) => void;
}) {
  return (
    <ul className="divide-y">
      {entries.map((entry) => (
        <ConfigRow
          key={entry.id}
          entry={entry}
          pending={pendingId === entry.id}
          selected={selectedId === entry.id}
          workspacePath={workspacePath}
          onOpen={() => onOpen(entry)}
          onToggle={(enabled) => onToggle(entry, enabled)}
        />
      ))}
    </ul>
  );
}

function RuntimeEntryRow({ entry }: { entry: McpRuntimeEntry }) {
  return (
    <li className="flex min-h-11 items-center gap-2 py-2">
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <Text full size="body" tone="bright">
          {entry.name}
        </Text>
        {entry.builtin ? <Badge variant="secondary">{copy.builtin}</Badge> : null}
      </span>
      <Text bare tone="muted" className="shrink-0 text-sm">
        {entry.toolNames.length > 0
          ? copy.runtimeTools(entry.toolNames.length)
          : (entry.status ?? copy.runtimeStatusUnknown)}
      </Text>
    </li>
  );
}

function EmptyLine({ children }: { children: string }) {
  return (
    <Text bare as="p" tone="muted" className="py-3 text-sm">
      {children}
    </Text>
  );
}

/** The runtime list, as a session reported it. */
function RuntimeBlock({
  section,
  filter,
  query,
}: {
  section: McpRuntimeSection;
  filter: KindFilter;
  query: string;
}) {
  if (filter === "config") return null;
  const needle = query.trim().toLowerCase();
  const entries = needle
    ? section.entries.filter((entry) => entry.name.toLowerCase().includes(needle))
    : section.entries;
  const ready = section.status === "ready" || section.status === "session_ended";
  const status = [
    runtimeStatusText[section.status],
    section.sessionId ? copy.runtimeSession(section.sessionId) : null,
    section.collectedAt
      ? copy.runtimeCollectedAt(timeFormat.format(new Date(section.collectedAt)))
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Section title={copy.runtimeTitle}>
      {ready ? (
        <>
          <Text bare as="p" tone="muted" className="pt-3 text-sm">
            {status}
          </Text>
          {entries.length === 0 ? (
            <EmptyLine>{needle ? copy.runtimeNoMatch : copy.runtimeEmpty}</EmptyLine>
          ) : (
            <ul className="divide-y">
              {entries.map((entry) => (
                <RuntimeEntryRow key={entry.name} entry={entry} />
              ))}
            </ul>
          )}
        </>
      ) : (
        <EmptyLine>{section.reason ?? runtimeStatusText[section.status]}</EmptyLine>
      )}
    </Section>
  );
}

function EngineChoice({
  engines,
  value,
  onChange,
}: {
  engines: McpEngineInventory[];
  value: McpEngineId | null;
  onChange: (id: McpEngineId) => void;
}) {
  return (
    <Select value={value ?? undefined} onValueChange={(id) => onChange(id as McpEngineId)}>
      <SelectTrigger aria-label="Engine" className="w-55 max-w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {engines.map((item) => (
          <SelectItem
            key={item.id}
            value={item.id}
            icon={<EngineMark engine={item.id} size={14} />}
            label={
              <>
                {engineLabel(item.id)}
                {item.config.entries.length > 0 ? (
                  <Text
                    bare
                    tone="muted"
                    className="ml-2"
                    aria-label={copy.tabCount(item.config.entries.length)}
                  >
                    {item.config.entries.length}
                  </Text>
                ) : null}
              </>
            }
          />
        ))}
      </SelectContent>
    </Select>
  );
}

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

export function McpSection() {
  const [folders, workspace, setWorkspace] = useMcpFolder();
  const store = useMcpInventory(workspace);
  const [engineId, setEngineId] = useState<McpEngineId>("claude");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const probeAll = useMcpProbeStore((state) => state.probeAll);
  const probingAll = useMcpProbeStore((state) => state.runningAll);
  const probeError = useMcpProbeStore((state) => state.error);
  const probeResults = useMcpProbeStore((state) => state.results);

  // Reloads replace the inventory; memoizing the engines keeps the `engine` lookup (and all that
  // follows from it) stable between renders that don't change it.
  const engines = useMemo(() => store.inventory?.engines ?? [], [store.inventory]);
  const engine = useMemo(
    () => engines.find((item) => item.id === engineId) ?? engines[0] ?? null,
    [engines, engineId],
  );
  // The dialog follows the list as read back, so after a switch it shows what's really in the file.
  const selected = useMemo(
    () => engine?.config.entries.find((entry) => entry.id === selectedId) ?? null,
    [engine, selectedId],
  );
  // Check on open (fresh results are reused; a changed config fills in only what's missing).
  useAutoProbe(engine?.config.entries, workspace);

  const filteredEntries = useMemo(() => {
    if (!engine) return [];
    const needle = query.trim().toLowerCase();
    return engine.config.entries.filter(
      (entry) => !needle || entry.name.toLowerCase().includes(needle),
    );
  }, [engine, query]);
  const noEntries = (engine?.config.entries.length ?? 0) === 0;
  const searching = query.trim().length > 0;
  const probeableCount = useMemo(
    () => (engine?.config.entries ?? []).filter(probeable).length,
    [engine],
  );
  const checkedAt = useMemo(
    () => latestCheckedAt(engine?.config.entries ?? [], probeResults),
    [engine, probeResults],
  );

  const reportError = (error: unknown) =>
    setToggleError(error instanceof Error ? error.message : String(error));
  const handleToggle = (entry: McpConfigEntry, enabled: boolean) => {
    setToggleError(null);
    void store.setEnabled(entry, enabled).catch(reportError);
  };
  const handleRefresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    void store.reload().finally(() => setRefreshing(false));
  };

  const loadError = typeof store.error === "string" ? store.error : (store.error?.message ?? null);
  const counts = [
    copy.count(engine?.config.entries.length ?? 0, engine?.runtime.entries.length ?? 0),
    checkedAt ? copy.probeLastChecked(timeFormat.format(new Date(checkedAt))) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      {loadError ? (
        <DesktopSettingsNotice
          action={
            <Button size="sm" onClick={() => void store.reload()}>
              {copy.refresh}
            </Button>
          }
        >
          {loadError}
        </DesktopSettingsNotice>
      ) : null}
      {toggleError ? <DesktopSettingsNotice>{toggleError}</DesktopSettingsNotice> : null}
      {probeError ? <DesktopSettingsNotice>{probeError}</DesktopSettingsNotice> : null}
      <Section title="MCP servers">
        <div className="flex min-w-0 items-center gap-2 py-3">
          <EngineChoice
            engines={engines}
            value={engine?.id ?? null}
            onChange={(id) => {
              setEngineId(id);
              setSelectedId(null);
            }}
          />
          <FolderChoice folders={folders} value={workspace} onChange={setWorkspace} />
          <SearchField
            containerClassName="min-w-40 flex-1"
            aria-label={copy.searchPlaceholder}
            placeholder={copy.searchPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="flex min-w-0 items-center gap-2 pb-3">
          <ChoiceGroup
            label="Show"
            size="sm"
            value={kind}
            onChange={setKind}
            options={[
              { value: "all", label: copy.filterAll },
              { value: "config", label: copy.filterConfig },
              { value: "runtime", label: copy.filterRuntime },
            ]}
          />
          <Text full tone="muted" className="min-w-0 flex-1 text-sm">
            {counts}
          </Text>
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
          <Button disabled={store.loading || refreshing} onClick={handleRefresh}>
            <RefreshCw className={cn(refreshing && "animate-spin")} aria-hidden />
            {copy.refresh}
          </Button>
        </div>
      </Section>
      {store.loading ? (
        <Section title={copy.configTitle}>
          <ConfigRowsSkeleton />
        </Section>
      ) : null}
      {engine ? <EngineNotices engine={engine} /> : null}
      {engine && engine.support !== "none" && kind !== "runtime" ? (
        <Section title={copy.configTitle}>
          {filteredEntries.length === 0 ? (
            <>
              <EmptyLine>{searching ? copy.runtimeNoMatch : copy.configEmpty}</EmptyLine>
              {noEntries && !searching ? (
                <McpSourceHint sources={engine.sources} workspacePath={workspace} />
              ) : null}
            </>
          ) : (
            <McpConfigList
              entries={filteredEntries}
              pendingId={store.pendingId}
              selectedId={selected?.id ?? null}
              workspacePath={workspace}
              onOpen={(entry) => setSelectedId(entry.id)}
              onToggle={handleToggle}
            />
          )}
        </Section>
      ) : null}
      {engine && engine.support !== "none" ? (
        <RuntimeBlock section={engine.runtime} filter={kind} query={query} />
      ) : null}
      {selected ? (
        <McpDetailDialog
          entry={selected}
          pending={store.pendingId === selected.id}
          workspacePath={workspace}
          onToggle={(enabled) => handleToggle(selected, enabled)}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
      <McpProbeConfirmHost />
    </>
  );
}
