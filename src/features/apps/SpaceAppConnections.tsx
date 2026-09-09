import { appSessionRequests } from "@/api/apps/sessionRequests";
import { apiRequest } from "@/api/client";
import { connectionsApi } from "@/api/connections/api";
import type { AccountConnectionsResponse } from "@/api/connections/types";
import { Button } from "@/shared/ui";
import { useEffect, useState } from "react";

/** This selector always edits the signed-in member's own connections. */
export function SpaceAppConnections({ spaceId, appId }: { spaceId: string; appId: string }) {
  const path = `/spaces/${encodeURIComponent(spaceId)}/apps/${encodeURIComponent(appId)}/personal-connections`;
  const [accounts, setAccounts] = useState<AccountConnectionsResponse["connections"]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let current = true;
    setReady(false);
    Promise.all([connectionsApi.list(), apiRequest<{ connection_ids: string[] }>(path)])
      .then(([available, selection]) => {
        if (!current) return;
        setAccounts(available.connections);
        setSelected(selection.connection_ids);
        setReady(true);
      })
      .catch((error: unknown) => {
        if (current) setError(String(error));
      });
    return () => {
      current = false;
    };
  }, [path]);
  return (
    <form
      className="w-full space-y-2 rounded border border-charcoal-border p-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        setSaved(false);
        try {
          await apiRequest(path, {
            method: "PUT",
            body: JSON.stringify({ connection_ids: selected }),
          });
          appSessionRequests.invalidate(appId, spaceId);
          setSaved(true);
        } catch (error) {
          setError(error instanceof Error ? error.message : String(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-sm font-medium">Your accounts for this app</p>
      <p className="text-xs text-cream-muted">
        Only accounts you select are available here. Other members choose their own.
      </p>
      {!ready && !error && (
        <p role="status" className="text-xs text-cream-muted">
          Loading accounts…
        </p>
      )}
      {ready && accounts.length === 0 && (
        <p className="text-xs text-cream-muted">
          Connect an account in account settings, then return here to select it.
        </p>
      )}
      {accounts.map((account) => (
        <label className="flex items-center gap-2 text-sm" key={account.id}>
          <input
            type="checkbox"
            checked={selected.includes(account.id)}
            disabled={busy}
            onChange={(event) => {
              setSaved(false);
              setSelected(
                event.target.checked
                  ? [...selected, account.id]
                  : selected.filter((id) => id !== account.id),
              );
            }}
          />
          {account.account_display || account.provider}
        </label>
      ))}
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-xs text-cream-muted">
          Saved. Reopen the app to use this selection.
        </p>
      )}
      <Button type="submit" variant="outline" disabled={!ready || busy}>
        Save your selection
      </Button>
    </form>
  );
}
