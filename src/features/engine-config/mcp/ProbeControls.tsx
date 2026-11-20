// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

/**
 * What a connection check shows: a status badge, the check in the details and its tools.
 *
 * The badge sits beside the entry's action on its shelf (to see everything at a glance); the
 * details give the error, the server's own name, its tools and how long it took. Results are kept
 * in `useMcpProbeStore`.
 */
import { AlertTriangle, Check, X } from "lucide-react";
import { useMemo } from "react";
import { Badge, Button, Spinner, Text, Tooltip } from "@misty/ui";
import { copy } from "./copy";
import { probeStateFor, useMcpProbeStore } from "./probe-store";
import type { McpConfigEntry } from "./types";

/** The connection state beside an entry's action; takes no room without a result. */
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
    // A working connection is the one state that carries color; the rest stay neutral.
    return (
      <Tooltip content={result.serverName ?? ""}>
        <Badge tone="green">
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

/** The check in the details: the latest result's state, the Check button, then what it found. */
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
  const about = state
    ? [
        state.result.serverName ? copy.probeServerName(state.result.serverName) : null,
        state.result.protocolVersion ? copy.probeProtocol(state.result.protocolVersion) : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex min-w-0 items-center gap-2">
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
        <ProbeStatusChip entry={entry} />
      </div>
      {state ? (
        <div className="grid min-w-0 gap-1">
          {state.result.message ? (
            <Text as="p" size="meta" tone="default" wrap className="m-0">
              {state.result.message}
            </Text>
          ) : null}
          {about ? (
            <Text as="p" size="meta" tone="muted" wrap className="m-0">
              {about}
            </Text>
          ) : null}
          <Text as="p" size="meta" tone="muted" wrap className="m-0">
            {copy.probeCheckedAt(checkedAt, state.result.elapsedMs)}
          </Text>
        </div>
      ) : null}
    </div>
  );
}

/** The tools the latest check found, one name a line, or nothing before a check. */
export function useProbeTools(entry: McpConfigEntry): { tools: string[]; total: number } | null {
  const results = useMcpProbeStore((state) => state.results);
  const state = probeStateFor(results, entry);
  if (!state || state.result.tools.length === 0) return null;
  return { tools: state.result.tools, total: state.result.toolCount };
}
