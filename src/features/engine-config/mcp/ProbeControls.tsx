// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

/**
 * What a connection check shows: a status badge, the check button and the details.
 *
 * The badge sits on the entry's row (to see everything at a glance); the details give the error,
 * the server's own name, its tools and how long it took. The settings block and the `/mcp` panel
 * share one set of results (`useMcpProbeStore`).
 */
import { Activity, AlertTriangle, Check, X } from "lucide-react";
import { useMemo } from "react";
import { Button, cn, IconButton, Spinner } from "@/shared/ui";
import { copy } from "./copy";
import { probeStateFor, useMcpProbeStore } from "./probe-store";
import type { McpConfigEntry } from "./types";

const BADGE =
  "inline-flex h-5 shrink-0 items-center gap-1 rounded-sm border px-1.5 text-micro leading-none";
// A working connection is the one state that carries color; the rest stay neutral.
const TONE = {
  connected: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  attention: "border-cream/10 bg-charcoal-card text-cream",
  error: "border-cream/10 bg-charcoal-card text-cream",
  pending: "border-cream/10 bg-charcoal-card text-cream-muted",
};

/** The connection state on a row; takes no room without a result. */
export function ProbeStatusChip({ entry }: { entry: McpConfigEntry }) {
  const results = useMcpProbeStore((state) => state.results);
  const pending = useMcpProbeStore((state) => Boolean(state.pending[entry.id]));
  if (pending) {
    return (
      <span className={cn(BADGE, TONE.pending)}>
        <Spinner size="sm" label={false} className="size-3" />
        {copy.probePending}
      </span>
    );
  }
  const state = probeStateFor(results, entry);
  if (!state) return null;
  const { result } = state;
  if (result.status === "connected") {
    return (
      <span className={cn(BADGE, TONE.connected)} title={result.serverName ?? undefined}>
        <Check className="size-3" aria-hidden />
        {result.toolCount > 0 ? copy.probeConnectedTools(result.toolCount) : copy.probeConnected}
      </span>
    );
  }
  if (result.status === "needs_auth") {
    return (
      <span className={cn(BADGE, TONE.attention)} title={result.message ?? undefined}>
        <AlertTriangle className="size-3" aria-hidden />
        {copy.probeNeedsAuth}
      </span>
    );
  }
  return (
    <span className={cn(BADGE, TONE.error)} title={result.message ?? undefined}>
      <X className="size-3" aria-hidden />
      {copy.probeFailed}
    </span>
  );
}

/** The check button on a row. */
export function ProbeActionButton({
  entry,
  workspacePath,
}: {
  entry: McpConfigEntry;
  workspacePath: string | null;
}) {
  const pending = useMcpProbeStore((state) => Boolean(state.pending[entry.id]));
  const probe = useMcpProbeStore((state) => state.probe);
  return (
    <IconButton
      label={copy.probeCheck(entry.name)}
      hint={copy.probeHint}
      disabled={pending}
      onClick={() => void probe(entry, workspacePath)}
    >
      {pending ? (
        <Spinner size="sm" label={false} className="size-3.5" />
      ) : (
        <Activity className="size-3.5" aria-hidden />
      )}
    </IconButton>
  );
}

/** The check area in the details dialog: the button and the latest result. */
export function ProbeDetail({
  entry,
  workspacePath,
}: {
  entry: McpConfigEntry;
  workspacePath: string | null;
}) {
  const results = useMcpProbeStore((state) => state.results);
  const pending = useMcpProbeStore((state) => Boolean(state.pending[entry.id]));
  const probe = useMcpProbeStore((state) => state.probe);
  const state = probeStateFor(results, entry);
  const timeFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    [],
  );
  const checkedAt = state ? timeFormat.format(new Date(state.checkedAt)) : "";
  return (
    <div className="grid gap-2 rounded-lg border border-charcoal-border px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-sm font-medium text-cream-bright">
          {copy.probeDetailTitle}
        </span>
        <ProbeStatusChip entry={entry} />
        <Button
          type="button"
          size="sm"
          title={copy.probeHint}
          disabled={pending}
          onClick={() => void probe(entry, workspacePath)}
        >
          {copy.probeCheckLabel}
        </Button>
      </div>
      {state ? (
        <div className="grid gap-1 text-xs leading-5 text-cream-muted">
          {state.result.message ? <p className="text-cream">{state.result.message}</p> : null}
          {state.result.serverName || state.result.protocolVersion ? (
            <p>
              {[
                state.result.serverName ? copy.probeServerName(state.result.serverName) : null,
                state.result.protocolVersion
                  ? copy.probeProtocol(state.result.protocolVersion)
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
          {state.result.tools.length > 0 ? (
            // A server can have hundreds of tools: the list scrolls on its own so the dialog
            // stays inside the window, and wraps after commas, never inside a name.
            <p className="max-h-40 overflow-y-auto break-words pr-1 font-mono">
              {state.result.toolCount > state.result.tools.length
                ? copy.probeToolListTruncated(
                    state.result.tools.length,
                    state.result.toolCount,
                    state.result.tools.join(", "),
                  )
                : copy.probeToolList(state.result.tools.join(", "))}
            </p>
          ) : null}
          <p>{copy.probeCheckedAt(checkedAt, state.result.elapsedMs)}</p>
        </div>
      ) : null}
    </div>
  );
}
