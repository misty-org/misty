import { observeAccountChanges } from "@/api/account-events";
import { appsApi, type ConnectedApp } from "../connected-apps/api";
import { agentsDeviceSnapshot } from "./useAgentsStore";
import type { AgentDeviceSnapshot } from "./agentScope";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { Button, ListRow, ListRowSkeleton, Text, useNotice } from "@/shared/ui";
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

const toConnections = (apps: ConnectedApp[]) =>
  apps.map((app): AccessConnection => ({
    id: app.id,
    app: app.app,
    name: app.alias || app.account ? `${app.name} · ${app.alias || app.account}` : app.name,
    status: app.status,
    detail: appStatus[app.status],
  }));

/** The last access each account showed this session, so reopening setup paints it at once. */
const shownAccess = new Map<string, AccessSnapshot>();
const lastAccess = (accountId: string) => shownAccess.get(accountId) ?? emptyAccess(accountId);

/**
 * Read-only account access. Profile setup never silently grants new permissions.
 * Refreshes keep the last result on screen, and the saved connections paint before the fresh
 * ones; only a first load with nothing saved reports `loading`.
 */
export function useAgentAccess(accountId: string, agentId = "") {
  const [state, setStateNow] = useState<AccessSnapshot>(() => lastAccess(accountId));
  const setState = useCallback((next: (previous: AccessSnapshot) => AccessSnapshot) => {
    setStateNow((previous) => {
      const value = next(previous);
      if (value.accountId && !value.loading) shownAccess.set(value.accountId, value);
      return value;
    });
  }, []);
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    let live = true;
    let request = 0;
    const refresh = async () => {
      const current = ++request;
      if (!accountId) {
        setState(() => emptyAccess(accountId));
        return;
      }
      setState((previous) => (previous.accountId === accountId ? previous : lastAccess(accountId)));
      // The saved list paints only while nothing is shown; the fresh one follows.
      const showSaved = (saved: { apps: ConnectedApp[] }) => {
        if (!live || current !== request) return;
        setState((previous) =>
          previous.accountId === accountId && previous.loading
            ? { ...previous, connections: toConnections(saved.apps), loading: false }
            : previous,
        );
      };
      const [apps, device] = await Promise.allSettled([
        appsApi.list(showSaved),
        hasTauriInternals() ? agentsDeviceSnapshot() : Promise.resolve(undefined),
      ]);
      if (!live || current !== request) return;
      setState((previous) => {
        const kept = previous.accountId === accountId ? previous : lastAccess(accountId);
        return {
          accountId,
          connections:
            apps.status === "fulfilled" ? toConnections(apps.value.apps) : kept.connections,
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
  }, [accountId, agentId, revision, setState]);
  return { ...(state.accountId === accountId ? state : lastAccess(accountId)), retry };
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
  useNotice(Boolean(access.connectionsError), {
    message: "Some connections couldn’t load.",
    tone: "error",
    action: { label: "Retry connections", onSelect: access.retry },
  });
  return (
    <div className="grid gap-5">
      <section aria-label="Context" className="grid gap-2">
        <Text bare as="h3" tone="muted" className="text-xs font-medium">
          Context
        </Text>
        <div className="flex items-start gap-3 py-1">
          <Text bare tone="muted" className="mt-0.5 flex shrink-0">
            <Layers />
          </Text>
          <div>
            <p className="text-sm">Your Misty account</p>
            <Text bare as="p" tone="muted" className="mt-1 text-xs">
              Space access follows your account permissions.
            </Text>
          </div>
        </div>
        <Text bare as="p" tone="muted" className="text-xs">
          Connected apps belong to your account. Every agent can use them.
        </Text>
        {access.loading ? (
          <ListRowSkeleton label="Connections" leading lines={2} rows={2} className="-mx-2" />
        ) : null}
        {!access.loading && access.connections.length ? (
          access.connections.map((connection) => (
            <ListRow
              key={connection.id}
              className="-mx-2"
              leading={Cable}
              label={connection.name}
              description={
                connection.detail ??
                (connection.status === "active"
                  ? "Connected"
                  : connection.status === "unchecked"
                    ? "Not checked"
                    : "Needs attention")
              }
              onOpen={() => onConnections()}
            />
          ))
        ) : !access.loading && !access.connectionsError ? (
          <Text bare as="p" tone="muted" className="text-xs">
            No tool connections.
          </Text>
        ) : null}
        <Button type="button" className="justify-self-start" onClick={() => onConnections()}>
          Manage connections
        </Button>
      </section>
    </div>
  );
}
