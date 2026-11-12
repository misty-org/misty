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
import { Activity, FolderOpen, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { EngineMark, hasEngineMark } from "../EngineMark";
import { folderName, useLinkedFolders } from "../host";
import { DesktopSettingsNotice, DesktopSettingsSection as Section } from "@/features/settings";
import {
  Button,
  cn,
  IconButton,
  Pressable,
  SearchField,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SkeletonList,
} from "@/shared/ui";
import { mcpApi } from "./api";
import { McpDetailDialog } from "./McpDetailDialog";
import { McpProbeConfirmHost } from "./McpProbeConfirmHost";
import { copy, engineLabel, runtimeStatusText, sourceLabel } from "./copy";
import { EnableToggle, LaunchModeToggle } from "./LaunchControls";
import { latestCheckedAt, probeable, useAutoProbe, useMcpProbeStore } from "./probe-store";
import { ProbeActionButton, ProbeStatusChip } from "./ProbeControls";
import type {
  McpConfigEntry,
  McpEngineId,
  McpEngineInventory,
  McpLaunchMode,
  McpRuntimeEntry,
  McpRuntimeSection,
  McpSourceInfo,
} from "./types";
import { useMcpInventory } from "./useMcpInventory";

type KindFilter = "all" | "config" | "runtime";

const NO_FOLDER = "__none__";

const pill =
  "inline-flex h-5 shrink-0 items-center rounded-sm border border-cream/10 bg-charcoal-hover px-1.5 text-2xs leading-none text-cream-muted";

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

function ConfigRow({
  entry,
  pending,
  selected,
  workspacePath,
  onOpen,
  onToggle,
  onLaunchMode,
}: {
  entry: McpConfigEntry;
  pending: boolean;
  selected: boolean;
  workspacePath: string | null;
  onOpen: () => void;
  onToggle: (enabled: boolean) => void;
  onLaunchMode: (mode: McpLaunchMode) => void;
}) {
  const meta = entry.command
    ? `${entry.command}${entry.argsCount > 0 ? ` +${entry.argsCount}` : ""}`
    : (entry.url ?? copy.transportUnknown);
  return (
    <li
      className={cn(
        "flex min-h-14 items-center gap-2 py-2",
        selected && "bg-charcoal-hover",
        pending && "opacity-60",
      )}
    >
      <Pressable
        onClick={onOpen}
        aria-label={copy.rowOpen(entry.name)}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md"
      >
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-md font-medium text-cream-bright" title={entry.name}>
              {entry.name}
            </span>
            <span className={pill}>{sourceLabel(entry.source)}</span>
            {!entry.enabled ? <span className={pill}>{copy.disabled}</span> : null}
          </span>
          <span className="truncate text-sm text-cream-muted" title={meta}>
            {entry.transport ? `${entry.transport} · ` : ""}
            {meta}
          </span>
        </span>
        {/* The badge is still inside the button, so clicking it opens the details too. */}
        <ProbeStatusChip entry={entry} />
      </Pressable>
      {probeable(entry) ? <ProbeActionButton entry={entry} workspacePath={workspacePath} /> : null}
      <LaunchModeToggle entry={entry} pending={pending} onChange={onLaunchMode} />
      <EnableToggle entry={entry} pending={pending} onChange={onToggle} />
    </li>
  );
}

/** One engine's configured servers; shared by the settings block and the `/mcp` panel so both show the same state. */
export function McpConfigList({
  entries,
  pendingId,
  selectedId,
  workspacePath,
  onOpen,
  onToggle,
  onLaunchMode,
}: {
  entries: McpConfigEntry[];
  pendingId: string | null;
  selectedId: string | null;
  workspacePath: string | null;
  onOpen: (entry: McpConfigEntry) => void;
  onToggle: (entry: McpConfigEntry, enabled: boolean) => void;
  onLaunchMode: (entry: McpConfigEntry, mode: McpLaunchMode) => void;
}) {
  return (
    <ul className="divide-y divide-charcoal-border">
      {entries.map((entry) => (
        <ConfigRow
          key={entry.id}
          entry={entry}
          pending={pendingId === entry.id}
          selected={selectedId === entry.id}
          workspacePath={workspacePath}
          onOpen={() => onOpen(entry)}
          onToggle={(enabled) => onToggle(entry, enabled)}
          onLaunchMode={(mode) => onLaunchMode(entry, mode)}
        />
      ))}
    </ul>
  );
}

function RuntimeEntryRow({ entry }: { entry: McpRuntimeEntry }) {
  return (
    <li className="flex min-h-11 items-center gap-2 py-2">
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-md text-cream-bright">{entry.name}</span>
        {entry.builtin ? <span className={pill}>{copy.builtin}</span> : null}
      </span>
      <span className="shrink-0 text-sm text-cream-muted">
        {entry.toolNames.length > 0
          ? copy.runtimeTools(entry.toolNames.length)
          : (entry.status ?? copy.runtimeStatusUnknown)}
      </span>
    </li>
  );
}

function EmptyLine({ children }: { children: string }) {
  return <p className="py-3 text-sm text-cream-muted">{children}</p>;
}

/** The runtime list, as a session reported it. */
export function RuntimeBlock({
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
          <p className="pt-3 text-sm text-cream-muted">{status}</p>
          {entries.length === 0 ? (
            <EmptyLine>{needle ? copy.runtimeNoMatch : copy.runtimeEmpty}</EmptyLine>
          ) : (
            <ul className="divide-y divide-charcoal-border">
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

/** Where Misty looks for the engine's config. Missing files still show, so an empty list never
 *  reads as "this CLI has no MCP". */
export function McpSourceHint({
  sources,
  workspacePath = null,
}: {
  sources: McpSourceInfo[];
  workspacePath?: string | null;
}) {
  if (sources.length === 0) return null;
  return (
    <div className="grid gap-1 pb-3">
      <span className="text-sm font-medium text-cream">{copy.sourcesTitle}</span>
      {sources.map((info) => (
        <span
          key={`${info.source}:${info.path}`}
          className="flex flex-wrap items-baseline gap-x-2 text-xs text-cream-muted"
        >
          <span className="shrink-0">{sourceLabel(info.source)}</span>
          <span className="min-w-0 break-all font-mono" title={info.path}>
            {info.path}
          </span>
          {!info.exists ? <span className="shrink-0">({copy.sourceMissing})</span> : null}
          <IconButton
            label={copy.reveal}
            size="2xs"
            variant="ghost"
            className="self-center"
            onClick={() => void mcpApi.reveal(info.path, workspacePath).catch(() => undefined)}
          >
            <FolderOpen aria-hidden />
          </IconButton>
        </span>
      ))}
    </div>
  );
}

function EngineNotices({ engine }: { engine: McpEngineInventory }) {
  const name = engineLabel(engine.id);
  const notes: string[] = [];
  if (engine.support === "none") notes.push(copy.supportNone(name));
  if (engine.support === "plugin") notes.push(copy.supportPlugin(name));
  if (engine.support !== "none" && !engine.available) notes.push(copy.notInstalled);
  if (notes.length === 0 && engine.config.errors.length === 0) return null;
  return (
    <div className="grid gap-2">
      {notes.map((note) => (
        <p key={note} className="rounded-lg bg-charcoal-hover px-3 py-2 text-sm text-cream">
          {note}
        </p>
      ))}
      {engine.config.errors.map((error) => (
        <p
          key={`${error.source}:${error.path}`}
          role="alert"
          className="rounded-lg border border-charcoal-border px-3 py-2 text-sm"
        >
          <span className="text-cream-bright">{error.message}</span>
          <span className="ml-2 break-all font-mono text-xs text-cream-muted">{error.path}</span>
        </p>
      ))}
    </div>
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
      <SelectTrigger aria-label="Engine" className="w-[220px] max-w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {engines.map((item) => (
          <SelectItem key={item.id} value={item.id}>
            <span className="flex items-center gap-2">
              {hasEngineMark(item.id) ? <EngineMark engine={item.id} size={14} /> : null}
              {engineLabel(item.id)}
              {item.config.entries.length > 0 ? (
                <span
                  className="text-cream-muted"
                  title={copy.tabCount(item.config.entries.length)}
                >
                  {item.config.entries.length}
                </span>
              ) : null}
            </span>
          </SelectItem>
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
      <SelectTrigger aria-label={copy.folder} className="w-[200px] max-w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_FOLDER}>{copy.folderNone}</SelectItem>
        {folders.map((folder) => (
          <SelectItem key={folder} value={folder} title={folder}>
            {folderName(folder)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The folder whose project config is read: the Space's chosen linked folder, or none. */
function useMcpFolder(): [string[], string | null, (folder: string | null) => void] {
  const { folders, picked: chosen } = useLinkedFolders();
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const fallback = chosen && folders.includes(chosen) ? chosen : (folders[0] ?? null);
  const folder =
    picked === undefined ? fallback : picked && folders.includes(picked) ? picked : null;
  return [folders, folder, setPicked];
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
  const handleLaunchMode = (entry: McpConfigEntry, mode: McpLaunchMode) => {
    setToggleError(null);
    void store.setLaunchMode(entry, mode).catch(reportError);
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
            <Button size="xs" variant="secondary" onClick={() => void store.reload()}>
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
        <div className="flex flex-wrap items-center gap-2 py-3">
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
            size="md"
            containerClassName="min-w-[160px] flex-1"
            aria-label={copy.searchPlaceholder}
            placeholder={copy.searchPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 pb-3">
          <SegmentedControl
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
          <span className="min-w-0 flex-1 truncate text-sm text-cream-muted">{counts}</span>
          <Button
            size="sm"
            variant="secondary"
            title={copy.probeHint}
            disabled={store.loading || probingAll || probeableCount === 0}
            onClick={() => void probeAll(engine?.config.entries ?? [], workspace, { force: true })}
          >
            <Activity aria-hidden />
            {copy.probeCheckAll}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={store.loading || refreshing}
            onClick={handleRefresh}
          >
            <RefreshCw className={cn(refreshing && "animate-spin")} aria-hidden />
            {copy.refresh}
          </Button>
        </div>
      </Section>
      {store.loading && !store.inventory ? (
        <Section title={copy.configTitle}>
          <SkeletonList label="MCP servers" rows={3} leading="none" trailing className="py-2" />
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
              onLaunchMode={handleLaunchMode}
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
          onLaunchMode={(mode) => handleLaunchMode(selected, mode)}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
      <McpProbeConfirmHost />
    </>
  );
}
