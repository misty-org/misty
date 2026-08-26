import { observeAccountChanges } from "@/api/accountEvents";
import { appsApi } from "../apps/api";
import { agentsDeviceSnapshot } from "../store/useAgentsStore";
import type { AgentDeviceSnapshot } from "../model/interfaces/types";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button, Skeleton } from "@/shared/ui";
import { Cable, Layers } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type AccessConnection = {
  id: string;
  /** The app's catalog id, which also names its brand artwork. */
  app: string;
  name: string;
  status: string;
  detail?: string;
};
const appStatus = {
  active: "Connected app",
  pending: "Waiting for sign-in",
  needs_attention: "Needs attention",
};

type AccessSnapshot = {
  accountId: string;
  connections: AccessConnection[];
  device?: AgentDeviceSnapshot;
  loading: boolean;
  connectionsError: boolean;
  deviceError: boolean;
};

const emptyAccess = (accountId: string): AccessSnapshot => ({
  accountId,
  connections: [],
  loading: Boolean(accountId),
  connectionsError: false,
  deviceError: false,
});

/**
 * Read-only account access. Profile setup never silently grants new permissions.
 * Refreshes keep the last result on screen; only the first load for an account
 * reports `loading`.
 */
export function useAgentAccess(accountId: string, agentId = "") {
  const [state, setState] = useState<AccessSnapshot>(() => emptyAccess(accountId));
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    let live = true;
    let request = 0;
    const refresh = async () => {
      const current = ++request;
      if (!accountId) {
        setState(emptyAccess(accountId));
        return;
      }
      setState((previous) =>
        previous.accountId === accountId ? previous : emptyAccess(accountId),
      );
      const [apps, device] = await Promise.allSettled([
        appsApi.list(),
        hasTauriInternals() ? agentsDeviceSnapshot() : Promise.resolve(undefined),
      ]);
      if (!live || current !== request) return;
      setState((previous) => {
        const kept = previous.accountId === accountId ? previous : emptyAccess(accountId);
        return {
          accountId,
          connections:
            apps.status === "fulfilled"
              ? apps.value.apps.map((app): AccessConnection => ({
                  id: app.id,
                  app: app.app,
                  name: app.alias ? `${app.name} · ${app.alias}` : app.name,
                  status: app.status,
                  detail: appStatus[app.status],
                }))
              : kept.connections,
          device: device.status === "fulfilled" ? device.value : kept.device,
          loading: false,
          connectionsError: apps.status === "rejected",
          deviceError: device.status === "rejected",
        };
      });
    };
    const stop = observeAccountChanges(accountId, ["connections", "devices"], refresh);
    return () => {
      live = false;
      stop();
    };
  }, [accountId, agentId, revision]);
  return { ...(state.accountId === accountId ? state : emptyAccess(accountId)), retry };
}
export type AgentAccessState = ReturnType<typeof useAgentAccess>;

/** Agent setup's read-only summary of what every agent can use. */
export function AgentAccess({
  access,
  onConnections,
}: {
  access: AgentAccessState;
  onConnections(): void;
}) {
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
        <p className="text-xs text-cream-muted">
          Connected apps belong to your account. Every agent can use them.
        </p>
        {access.loading ? (
          <div role="status" aria-label="Connections" aria-busy="true" className="grid gap-1">
            {[0, 1].map((row) => (
              <div key={row} className="flex min-h-9 items-center gap-3">
                <Skeleton className="size-4 shrink-0 rounded" />
                <span className="grid gap-1.5">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-2.5 w-20" />
                </span>
              </div>
            ))}
          </div>
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
    </div>
  );
}
