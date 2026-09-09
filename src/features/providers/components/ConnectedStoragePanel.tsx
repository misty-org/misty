import { useEffect, useRef, useState } from "react";
import { PlatformPanel } from "../../../../../misty-apps/apps/shared/PlatformPanel";
import { PlatformDirectory } from "../../../../../misty-apps/apps/shared/PlatformDirectory";
import "../../../../../misty-apps/apps/shared/providers.css";
import { Button } from "@/shared/ui";
import { useProvidersStore } from "../store";
import { ProviderLogo } from "./ProviderLogo";
import { ProviderConnectionForm } from "./ProviderConnectionDialog";

const providerNames: Record<string, string> = {
  drive: "Google Drive",
  dropbox: "Dropbox",
  onedrive: "OneDrive",
};
const descriptions: Record<string, string> = {
  drive: "Browse your Google Drive files and shared drives.",
  dropbox: "Browse your Dropbox files and folders.",
  onedrive: "Browse your personal and work files in OneDrive.",
};

/** The same directory and single modal surface as Inbox, Planner, and Library. */
export function ConnectedStoragePanel({ onClose }: { onClose(): void }) {
  const state = useProvidersStore();
  const [selected, setSelected] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const alive = useRef(true);
  const { load, closeConnection, cancelDisconnect } = state;
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
      closeConnection();
      cancelDisconnect();
    };
  }, [load, closeConnection, cancelDisconnect]);

  const remotes = state.providers?.remotes ?? [];
  const workflows = [...(state.providers?.workflows ?? [])];
  for (const remote of remotes) {
    if (!workflows.some((item) => item.type === remote.type))
      workflows.push({
        type: remote.type,
        name: providerNames[remote.type] || remote.type,
        description: "",
        options: [],
      });
  }
  const session = state.connection?.stage !== "provider" ? state.connection : null;
  const providerType = session?.providerType ?? selected;
  const providerName =
    providerType &&
    (providerNames[providerType] ||
      workflows.find((item) => item.type === providerType)?.name ||
      providerType);
  const accounts = remotes.filter((remote) => remote.type === selected);
  const error = state.error || state.providers?.error || state.providers?.health.error || undefined;

  async function addAccount(type: string) {
    setBusy(type);
    setSelected(type);
    try {
      if (!useProvidersStore.getState().connection) await state.openAddRemote();
      if (!alive.current) return;
      const current = useProvidersStore.getState();
      if (!current.connection) return;
      current.chooseConnectionProvider(type);
      // Keep multiple accounts distinct without making users invent an internal remote ID.
      let name = type;
      let suffix = 2;
      while (remotes.some((remote) => remote.name === name)) name = `${type}-${suffix++}`;
      current.setConnectionName(name);
      current.advanceConnection();
    } finally {
      if (alive.current) setBusy(undefined);
    }
  }

  const goBack = () => {
    if (state.disconnectTarget) state.cancelDisconnect();
    else if (session) state.closeConnection();
    else setSelected(undefined);
  };

  return (
    <PlatformPanel
      open
      title={state.disconnectTarget ? "Disconnect storage" : providerName || "Connected storage"}
      onClose={onClose}
      onBack={selected || session || state.disconnectTarget ? goBack : undefined}
      backLabel={
        session || state.disconnectTarget ? providerName || "storage" : "connected storage"
      }
      compact={Boolean(providerType || state.disconnectTarget)}
    >
      {state.disconnectTarget ? (
        <div className="grid gap-5">
          <p className="text-sm leading-6 text-cream-muted">
            Remove <strong className="text-cream">{state.disconnectTarget}</strong> from Misty?
            Files stored with the provider will stay there.
          </p>
          {error && (
            <p role="alert" className="text-sm text-cream-muted">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={state.working} onClick={state.cancelDisconnect}>
              Cancel
            </Button>
            <Button disabled={state.working} onClick={() => void state.confirmDisconnect()}>
              {state.working ? "Disconnecting…" : "Disconnect"}
            </Button>
          </div>
        </div>
      ) : session ? (
        <ProviderConnectionForm
          session={session}
          workflows={workflows}
          onClose={state.closeConnection}
          onChooseProvider={state.chooseConnectionProvider}
          onName={state.setConnectionName}
          onParameter={state.setConnectionParameter}
          onAdvance={state.advanceConnection}
          onSubmit={(polling) => void state.submitConnection(polling)}
          onOpenAuthorize={() => void state.reopenConnectionAuthorization()}
        />
      ) : selected ? (
        <div className="grid gap-5">
          <div className="flex items-center gap-3">
            <ProviderLogo type={selected} size={32} />
            <p className="text-sm leading-6 text-cream-muted">
              {descriptions[selected] || "Manage the storage accounts connected to Files."}
            </p>
          </div>
          {error && (
            <p role="alert" className="text-sm text-cream-muted">
              {error}{" "}
              <button className="underline" onClick={() => void load(true)}>
                Retry
              </button>
            </p>
          )}
          {accounts.length ? (
            <ul className="divide-y divide-charcoal-border" aria-label={`${providerName} accounts`}>
              {accounts.map((remote) => (
                <li
                  key={remote.name}
                  className="flex flex-wrap items-center justify-between gap-3 py-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm text-cream">{remote.name}</p>
                    <p className="mt-1 text-xs text-cream-muted">
                      {remote.error ||
                        (remote.needsReconnect
                          ? "Sign in again to reconnect"
                          : "Connected to Files")}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={state.working}
                      onClick={() => void state.openRepairRemote(remote)}
                    >
                      Reconnect
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={state.working}
                      onClick={() => state.requestDisconnect(remote.name)}
                    >
                      Disconnect
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-cream-muted">No accounts connected yet.</p>
          )}
          <Button
            className="justify-self-start"
            disabled={Boolean(busy) || state.working || state.loading}
            onClick={() => void addAccount(selected)}
          >
            {busy ? "Opening…" : "Add account"}
          </Button>
        </div>
      ) : (
        <PlatformDirectory
          title="Connected storage"
          embedded
          loading={state.loading}
          error={error}
          onRetry={() => void load(true)}
          busy={busy || (state.working ? "working" : undefined)}
          entries={workflows.map((workflow) => {
            const connected = remotes.filter((remote) => remote.type === workflow.type);
            const label = providerNames[workflow.type] || workflow.name || workflow.type;
            return {
              id: workflow.type,
              label,
              icon: <ProviderLogo type={workflow.type} size={26} />,
              description: connected.length
                ? connected.some((remote) => remote.needsReconnect)
                  ? "Connection needs attention"
                  : `${connected.length} connected ${connected.length === 1 ? "account" : "accounts"}`
                : descriptions[workflow.type] ||
                  workflow.description ||
                  "Connect your storage account.",
              added: connected.length > 0,
              onSelect: () => setSelected(workflow.type),
              onOpen: () =>
                connected.length ? setSelected(workflow.type) : void addAccount(workflow.type),
            };
          })}
        />
      )}
    </PlatformPanel>
  );
}
