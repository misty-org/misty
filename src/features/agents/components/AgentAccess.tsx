import { observeAccountChanges } from "@/api/accountEvents";
import { mcpConnectionsApi } from "../mcp/api";
import type { McpConnection } from "../mcp/types";
import { agentsDeviceSnapshot } from "../store/useAgentsStore";
import type { AgentDeviceSnapshot } from "../model/interfaces/types";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button } from "@/shared/ui";
import { Cable, Laptop, Layers } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

/** Read-only account access. Profile setup never silently grants new permissions. */
export function useAgentAccess(accountId: string) {
  const [state, setState] = useState<{
    accountId: string;
    connections: McpConnection[];
    device?: AgentDeviceSnapshot;
    loading: boolean;
    connectionsError: boolean;
    deviceError: boolean;
  }>({
    accountId,
    connections: [],
    loading: Boolean(accountId),
    connectionsError: false,
    deviceError: false,
  });
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    let live = true;
    let request = 0;
    const refresh = async () => {
      const current = ++request;
      setState({
        accountId,
        connections: [],
        loading: Boolean(accountId),
        connectionsError: false,
        deviceError: false,
      });
      if (!accountId) return;
      const [connections, device] = await Promise.allSettled([
        mcpConnectionsApi.list(),
        hasTauriInternals() ? agentsDeviceSnapshot() : Promise.resolve(undefined),
      ]);
      if (!live || current !== request) return;
      setState({
        accountId,
        connections:
          connections.status === "fulfilled"
            ? connections.value.connections.filter((c) => c.status !== "revoked")
            : [],
        device: device.status === "fulfilled" ? device.value : undefined,
        loading: false,
        connectionsError: connections.status === "rejected",
        deviceError: device.status === "rejected",
      });
    };
    const stop = observeAccountChanges(accountId, ["connections", "devices"], refresh);
    return () => {
      live = false;
      stop();
    };
  }, [accountId, revision]);
  return {
    ...(state.accountId === accountId
      ? state
      : {
          accountId,
          connections: [],
          loading: Boolean(accountId),
          connectionsError: false,
          deviceError: false,
        }),
    retry,
  };
}
export type AgentAccessState = ReturnType<typeof useAgentAccess>;

export function AgentAccess({
  access,
  onConnections,
  onCompanion,
  compact = false,
  showComputer = true,
}: {
  access: AgentAccessState;
  onConnections(): void;
  onCompanion(): void;
  compact?: boolean;
  showComputer?: boolean;
}) {
  const device = access.device?.device;
  return (
    <div className="grid gap-5">
      <section aria-label="Context" className="grid gap-2">
        <h3 className="text-xs font-medium text-cream-muted">Context</h3>
        <div className="flex items-start gap-3 py-1">
          <Layers className="mt-0.5 size-4 shrink-0 text-cream-muted" />
          <div>
            <p className="text-sm">Your Misty account</p>
            <p className="mt-1 text-xs text-cream-muted">
              Space access follows your account permissions.
            </p>
          </div>
        </div>
        {!compact && (
          <p className="text-xs text-cream-muted">Connections are shared across your agents.</p>
        )}
        {access.loading ? (
          <p role="status" className="text-xs text-cream-muted">
            Loading connections…
          </p>
        ) : access.connectionsError ? (
          <div role="alert" className="text-xs text-cream-muted">
            Connections couldn’t load.{" "}
            <Button type="button" variant="ghost" size="xs" onClick={access.retry}>
              Retry connections
            </Button>
          </div>
        ) : access.connections.length ? (
          access.connections.map((connection) => (
            <Button
              type="button"
              key={connection.id}
              variant="ghost"
              justify="start"
              className="h-auto min-h-9 gap-3 whitespace-normal px-0 text-left"
              onClick={onConnections}
            >
              <Cable className="size-4 shrink-0 text-cream-muted" />
              <span className="min-w-0">
                <span className="block truncate">{connection.name}</span>
                <span className="block text-xs font-normal text-cream-muted">
                  {connection.status === "active"
                    ? "Connected"
                    : connection.status === "unchecked"
                      ? "Not checked"
                      : "Needs attention"}
                </span>
              </span>
            </Button>
          ))
        ) : (
          <p className="text-xs text-cream-muted">No tool connections.</p>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="justify-self-start"
          onClick={onConnections}
        >
          Manage connections
        </Button>
      </section>
      {showComputer && (
        <section aria-label="Computer" className="grid gap-2">
          <h3 className="text-xs font-medium text-cream-muted">Computer</h3>
          <Button
            type="button"
            variant="ghost"
            justify="start"
            className="h-auto min-h-10 gap-3 whitespace-normal px-0 text-left"
            onClick={onCompanion}
          >
            <Laptop className="size-4 shrink-0 text-cream-muted" />
            <span className="min-w-0">
              <span className="block truncate">{device?.displayName || "Desktop companion"}</span>
              <span className="block text-xs font-normal text-cream-muted">
                {access.deviceError
                  ? "Device unavailable"
                  : device
                    ? device.status === "online"
                      ? "Online"
                      : device.status === "revoked"
                        ? "Access revoked"
                        : "Offline"
                    : "Available in the desktop app"}
              </span>
            </span>
          </Button>
        </section>
      )}
    </div>
  );
}
