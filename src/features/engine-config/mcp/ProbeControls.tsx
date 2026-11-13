// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

/**
 * What a connection check shows: a status badge, the check button and the details.
 *
 * The badge sits on the entry's row (to see everything at a glance); the details give the error,
 * the server's own name, its tools and how long it took. Results are kept in `useMcpProbeStore`.
 */
import { Activity, AlertTriangle, Check, X } from "lucide-react";
import { useMemo } from "react";
import { Badge, Button, IconButton, Spinner, Surface, Text, Tooltip } from "@/shared/ui";
import { copy } from "./copy";
import { probeStateFor, useMcpProbeStore } from "./probe-store";
import type { McpConfigEntry } from "./types";

// A working connection is the one state that carries color; the rest stay neutral.
const CONNECTED = "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";

/** The connection state on a row; takes no room without a result. */
export function ProbeStatusChip({ entry }: { entry: McpConfigEntry }) {
  const results = useMcpProbeStore((state) => state.results);
  const pending = useMcpProbeStore((state) => Boolean(state.pending[entry.id]));
  if (pending) {
    return (
      <Badge variant="secondary">
        <Spinner size="sm" label={false} className="size-3" />
        {copy.probePending}
      </Badge>
    );
  }
  const state = probeStateFor(results, entry);
  if (!state) return null;
  const { result } = state;
  if (result.status === "connected") {
    return (
      <Tooltip content={result.serverName ?? ""}>
        <Badge variant="outline" className={CONNECTED}>
          <Check aria-hidden />
          {result.toolCount > 0 ? copy.probeConnectedTools(result.toolCount) : copy.probeConnected}
        </Badge>
      </Tooltip>
    );
  }
  if (result.status === "needs_auth") {
    return (
      <Tooltip content={result.message ?? ""}>
        <Badge variant="secondary" tabIndex={result.message ? 0 : undefined}>
          <AlertTriangle aria-hidden />
          {copy.probeNeedsAuth}
        </Badge>
      </Tooltip>
    );
  }
  return (
    <Tooltip content={result.message ?? ""}>
      <Badge variant="secondary" tabIndex={result.message ? 0 : undefined}>
        <X aria-hidden />
        {copy.probeFailed}
      </Badge>
    </Tooltip>
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
        <Activity aria-hidden />
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
    <Surface tone="none" edge="hairline" radius="lg" className="grid gap-2 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Text bare tone="bright" weight="medium" className="min-w-0 flex-1 text-sm">
          {copy.probeDetailTitle}
        </Text>
        <ProbeStatusChip entry={entry} />
        <Tooltip content={copy.probeHint}>
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => void probe(entry, workspacePath)}
          >
            {copy.probeCheckLabel}
          </Button>
        </Tooltip>
      </div>
      {state ? (
        <Text bare as="div" tone="muted" className="grid gap-1 text-xs leading-5">
          {state.result.message ? (
            <Text bare as="p" tone="default">
              {state.result.message}
            </Text>
          ) : null}
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
            <p className="max-h-40 overflow-y-auto break-words pr-1">
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
        </Text>
      ) : null}
    </Surface>
  );
}
