import { Check, Plug, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { confirmAction } from "@/shared/lib/confirmAction";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import { Button, Input } from "@/shared/ui";
import { appsApi, type CatalogApp, type ConnectedApp } from "./api";

const statusLabel: Record<ConnectedApp["status"], string> = {
  active: "Connected",
  pending: "Waiting for sign-in",
  needs_attention: "Needs attention · Reconnect",
};

/** Account-wide connected apps. Every agent can use them; nothing is set per agent. */
export function ConnectedAppsCatalog() {
  const [apps, setApps] = useState<ConnectedApp[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogApp[]>([]);
  const [signingIn, setSigningIn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const result = await appsApi.list();
    setAvailable(result.available);
    setApps(result.apps);
  }, []);
  useEffect(() => {
    let live = true;
    appsApi
      .list()
      .then((result) => {
        if (!live) return;
        setAvailable(result.available);
        setApps(result.apps);
      })
      .catch((reason: unknown) => live && setError(message(reason, "Apps could not be loaded.")));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!available) return;
    let live = true;
    const timer = window.setTimeout(() => {
      appsApi
        .catalog(query.trim())
        .then((result) => live && setResults(result.apps))
        .catch(
          (reason: unknown) =>
            live && setError(message(reason, "The app list could not be loaded.")),
        );
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [query, available]);

  async function act(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (reason) {
      setError(message(reason, "The app could not be updated."));
    } finally {
      setBusy(false);
    }
  }
  const connect = (app: CatalogApp) =>
    act(async () => {
      const { url } = await appsApi.connect(app.app);
      await openExternalLink(url);
      setSigningIn(app.name);
    });
  const disconnect = (item: ConnectedApp) =>
    act(async () => {
      if (
        !(await confirmAction(
          `Disconnect ${item.name}? Agents lose access right away.`,
          "Disconnect app",
        ))
      )
        return;
      await appsApi.disconnect(item.id);
      await refresh();
    });

  return (
    <section className="agent-studio-workflows" aria-label="Connected apps">
      <div className="agent-studio-heading">
        <div>
          <h1>Connected apps</h1>
          <p>
            Agents use these accounts when you ask. Sends, shares, deletes and payments ask you
            first.
          </p>
        </div>
        <Button variant="outline" disabled={busy} onClick={() => void act(refresh)}>
          <RefreshCw size={14} /> Refresh
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-4 text-sm text-cream-muted">
          {error}
        </p>
      ) : null}
      {!available ? (
        <p className="mt-6 text-sm text-cream-muted">
          Connected apps are not set up on this Misty server.
        </p>
      ) : null}
      {signingIn ? (
        <p className="mt-4 text-sm text-cream-muted">
          Finish signing in to {signingIn} in your browser, then refresh.
        </p>
      ) : null}
      {apps === null && !error ? (
        <p className="mt-6 text-sm text-cream-muted">Loading apps…</p>
      ) : null}
      {apps?.map((item) => (
        <div
          key={item.id}
          className="mt-3 flex items-center justify-between gap-4 rounded-lg border border-charcoal-border p-4"
        >
          <div className="flex min-w-0 items-center gap-3">
            <Plug size={18} className="shrink-0 text-cream-muted" aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="truncate font-medium">
                {item.alias ? `${item.name} · ${item.alias}` : item.name}
              </h2>
              <p className="text-sm text-cream-muted">{statusLabel[item.status]}</p>
            </div>
          </div>
          <Button variant="ghost" disabled={busy} onClick={() => void disconnect(item)}>
            Disconnect
          </Button>
        </div>
      ))}
      {available ? (
        <>
          <label className="mt-8 flex max-w-md items-center gap-2 text-sm">
            <Search size={14} className="text-cream-muted" aria-hidden="true" />
            <Input
              value={query}
              maxLength={100}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find an app, such as Gmail or Notion"
              aria-label="Find an app"
            />
          </label>
          <div className="mt-3 grid gap-2">
            {results.map((app) => (
              <div
                key={app.app}
                className="flex items-center justify-between gap-4 rounded-lg border border-charcoal-border px-4 py-3"
              >
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-medium">{app.name}</h3>
                  <p className="line-clamp-2 text-xs text-cream-muted">{app.description}</p>
                </div>
                {app.connected ? (
                  <span className="flex shrink-0 items-center gap-1 text-xs text-cream-muted">
                    <Check size={12} aria-hidden="true" /> Connected
                  </span>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void connect(app)}
                  >
                    Connect
                  </Button>
                )}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

function message(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}
