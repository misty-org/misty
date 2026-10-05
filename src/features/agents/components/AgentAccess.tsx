import { observeAccountChanges } from "@/api/accountEvents";
import { appsApi } from "../apps/api";
import { agentsDeviceSnapshot } from "../store/useAgentsStore";
import type { AgentDeviceSnapshot } from "../model/interfaces/types";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button } from "@/shared/ui";
import { Cable, Laptop, Layers } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { SharedFolders } from "./SharedFolders";

type AccessConnection = {
  id: string;
  name: string;
  status: string;
  detail?: string;
};
const appStatus = {
  active: "Connected app",
  pending: "Waiting for sign-in",
  needs_attention: "Needs attention",
};

/** Read-only account access. Profile setup never silently grants new permissions. */
export function useAgentAccess(accountId: string, agentId = "") {
  const [state, setState] = useState<{
    accountId: string;
    agentId: string;
    connections: AccessConnection[];
    device?: AgentDeviceSnapshot;
    loading: boolean;
    connectionsError: boolean;
    deviceError: boolean;
  }>({
    accountId,
    agentId,
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
        agentId,
        connections: [],
        loading: Boolean(accountId),
        connectionsError: false,
        deviceError: false,
      });
      if (!accountId) return;
      const [apps, device] = await Promise.allSettled([
        appsApi.list(),
        hasTauriInternals() ? agentsDeviceSnapshot() : Promise.resolve(undefined),
      ]);
      if (!live || current !== request) return;
      setState({
        accountId,
        agentId,
        connections:
          apps.status === "fulfilled"
            ? apps.value.apps.map((app): AccessConnection => ({
                id: app.id,
                name: app.alias ? `${app.name} · ${app.alias}` : app.name,
                status: app.status,
                detail: appStatus[app.status],
              }))
            : [],
        device: device.status === "fulfilled" ? device.value : undefined,
        loading: false,
        connectionsError: apps.status === "rejected",
        deviceError: device.status === "rejected",
      });
    };
    const stop = observeAccountChanges(accountId, ["connections", "devices"], refresh);
    return () => {
      live = false;
      stop();
    };
  }, [accountId, agentId, revision]);
  return {
    ...(state.accountId === accountId && state.agentId === agentId
      ? state
      : {
          accountId,
          agentId,
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
          <div title={compact ? "Space access follows your account permissions." : undefined}>
            <p className="text-sm">Your Misty account</p>
            {!compact && (
              <p className="mt-1 text-xs text-cream-muted">
                Space access follows your account permissions.
              </p>
            )}
          </div>
        </div>
        {!compact && (
          <p className="text-xs text-cream-muted">
            Connected apps belong to your account. Every agent can use them.
          </p>
        )}
        {access.loading ? (
          <p role="status" className="text-xs text-cream-muted">
            Loading connections…
          </p>
        ) : null}
        {access.connectionsError && (
          <div role="alert" className="text-xs text-cream-muted">
            Some connections couldn’t load.{" "}
            <Button type="button" variant="ghost" size="xs" onClick={access.retry}>
              Retry connections
            </Button>
          </div>
        )}
        {!access.loading && access.connections.length ? (
          access.connections.map((connection) => (
            <Button
              type="button"
              key={connection.id}
              variant="ghost"
              justify="start"
              className="h-auto min-h-9 -mx-2 gap-3 whitespace-normal px-2 text-left"
              onClick={onConnections}
            >
              <Cable className="size-4 shrink-0 text-cream-muted" />
              <span className="min-w-0">
                <span className="block truncate">{connection.name}</span>
                <span className="block text-xs font-normal text-cream-muted">
                  {connection.detail ??
                    (connection.status === "active"
                      ? "Connected"
                      : connection.status === "unchecked"
                        ? "Not checked"
                        : "Needs attention")}
                </span>
              </span>
            </Button>
          ))
        ) : !access.loading && !access.connectionsError ? (
          <p className="text-xs text-cream-muted">No tool connections.</p>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="justify-self-start"
          onClick={() => onConnections()}
        >
          Manage connections
        </Button>
      </section>
      {showComputer && <SharedFolders />}
      {showComputer && (
        <section aria-label="Computer" className="grid gap-2">
          <h3 className="text-xs font-medium text-cream-muted">Computer</h3>
          <Button
            type="button"
            variant="ghost"
            justify="start"
            className="h-auto min-h-10 -mx-2 gap-3 whitespace-normal px-2 text-left"
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
