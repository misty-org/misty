// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

/**
 * `/mcp`: the MCP panel the composer opens, like a CLI's own `/mcp` command. It lists the chat
 * engine's configured servers and their runtime state.
 *
 * It reads the same `engine_mcp_inventory` as Settings (`useMcpInventory`), so "on in config"
 * and "connected at runtime" always agree between the two; the panel has no search or filters
 * and only answers "which MCP servers does this CLI have, and in what state".
 */
import { RefreshCw, Settings } from "lucide-react";
import { useMemo, useState } from "react";
import { openSettingsEvent } from "@/features/settings";
import { Button, cn, Dialog, DialogContent, DialogTitle, SkeletonList } from "@/shared/ui";
import { copy, engineLabel } from "./copy";
import { McpDetailDialog } from "./McpDetailDialog";
import { McpConfigList, McpSourceHint, RuntimeBlock } from "./McpSection";
import { useMcpPanel } from "./panel";
import { latestCheckedAt, probeable, useAutoProbe, useMcpProbeStore } from "./probe-store";
import type { McpConfigEntry, McpLaunchMode } from "./types";
import { useMcpInventory } from "./useMcpInventory";

/** The Settings block MCP servers are registered under. */
export const MCP_SETTINGS_SECTION = "engine-mcp";

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

export function McpCommandPanel() {
  const open = useMcpPanel((state) => state.open);
  if (!open) return null;
  return <PanelBody />;
}

function PanelBody() {
  const closePanel = useMcpPanel((state) => state.closePanel);
  const engineId = useMcpPanel((state) => state.engine);
  const workspacePath = useMcpPanel((state) => state.workspace);
  const store = useMcpInventory(workspacePath);
  const engine = store.inventory?.engines.find((item) => item.id === engineId) ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The dialog follows the list as read back (after a switch it shows the real state).
  const selected = engine?.config.entries.find((entry) => entry.id === selectedId) ?? null;
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const probeAll = useMcpProbeStore((state) => state.probeAll);
  const probingAll = useMcpProbeStore((state) => state.runningAll);
  const probeError = useMcpProbeStore((state) => state.error);
  const probeResults = useMcpProbeStore((state) => state.results);
  const label = engineLabel(engineId);
  const probeableCount = (engine?.config.entries ?? []).filter(probeable).length;
  // Check on open; a fresh cache is reused, so opening again doesn't start servers again.
  useAutoProbe(engine?.config.entries, workspacePath);
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
  const alerts = [loadError, toggleError, probeError].filter(Boolean) as string[];

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : closePanel())}>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[70vh] w-[600px] max-w-[94vw] flex-col gap-3 p-5"
      >
        <div className="flex items-center gap-2 pr-10">
          <DialogTitle className="min-w-0 flex-1 truncate text-base">
            {copy.panelHeading(label)}
          </DialogTitle>
          <Button
            title={copy.probeHint}
            disabled={store.loading || probingAll || probeableCount === 0}
            onClick={() => void probeAll(engine?.config.entries ?? [], workspacePath)}
          >
            {copy.probeCheckAll}
          </Button>
          <Button disabled={store.loading || refreshing} onClick={handleRefresh}>
            <RefreshCw className={cn(refreshing && "animate-spin")} aria-hidden />
            {copy.refresh}
          </Button>
          <Button
            onClick={() => {
              closePanel();
              // The Settings block id the MCP servers section is registered under.
              window.dispatchEvent(
                new CustomEvent(openSettingsEvent, { detail: { section: MCP_SETTINGS_SECTION } }),
              );
            }}
          >
            <Settings aria-hidden />
            {copy.panelManage}
          </Button>
        </div>
        <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto pr-1">
          {store.loading && !store.inventory ? (
            <SkeletonList lines={2} label="MCP servers" rows={3} leading="none" trailing />
          ) : null}
          {alerts.map((alert) => (
            <p key={alert} role="alert" className="text-sm text-cream-bright">
              {alert}
            </p>
          ))}
          {engine?.support === "none" ? (
            <p className="rounded-lg bg-charcoal-hover px-3 py-2 text-sm text-cream">
              {copy.supportNone(label)}
            </p>
          ) : null}
          {engine && engine.support !== "none" ? (
            <>
              {engine.config.errors.map((error) => (
                <p
                  key={`${error.source}:${error.path}`}
                  className="rounded-lg border border-charcoal-border px-3 py-2 text-sm"
                >
                  <span className="text-cream-bright">{error.message}</span>
                  <span className="ml-2 break-all font-mono text-xs text-cream-muted">
                    {error.path}
                  </span>
                </p>
              ))}
              <h3 className="text-sm font-medium text-cream-bright">
                {copy.configTitle}
                {checkedAt
                  ? ` · ${copy.probeLastChecked(timeFormat.format(new Date(checkedAt)))}`
                  : ""}
              </h3>
              {engine.config.entries.length === 0 ? (
                <>
                  <p className="text-sm text-cream-muted">{copy.configEmpty}</p>
                  <McpSourceHint sources={engine.sources} workspacePath={workspacePath} />
                </>
              ) : (
                <McpConfigList
                  entries={engine.config.entries}
                  pendingId={store.pendingId}
                  selectedId={selected?.id ?? null}
                  workspacePath={workspacePath}
                  onOpen={(entry) => setSelectedId(entry.id)}
                  onToggle={handleToggle}
                  onLaunchMode={handleLaunchMode}
                />
              )}
              <RuntimeBlock section={engine.runtime} filter="all" query="" />
              {!engine.available ? (
                <p className="rounded-lg bg-charcoal-hover px-3 py-2 text-sm text-cream">
                  {copy.notInstalled}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
        {selected ? (
          <McpDetailDialog
            entry={selected}
            pending={store.pendingId === selected.id}
            workspacePath={workspacePath}
            onToggle={(enabled) => handleToggle(selected, enabled)}
            onLaunchMode={(mode) => handleLaunchMode(selected, mode)}
            onClose={() => setSelectedId(null)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
