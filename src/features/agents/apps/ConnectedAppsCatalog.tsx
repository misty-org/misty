import { Check, CircleAlert, Plug, Plus, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { confirmAction } from "@/shared/lib/confirmAction";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import { BrandIcon, brandIconAsset, Button, IconButton, Input, SkeletonList } from "@/shared/ui";
import { appsApi, type CatalogApp, type ConnectedApp } from "./api";

/** Official brand artwork when the shared registry has it; a monochrome plug otherwise. */
export function AppLogo({ app, size = 24 }: { app: string; size?: number }) {
  return brandIconAsset(app) ? (
    <BrandIcon brand={app} size={size} />
  ) : (
    <Plug size={Math.round(size * 0.75)} className="text-cream-muted" aria-hidden="true" />
  );
}

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
  const connect = (app: { app: string; name: string }) =>
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
    <>
      <section aria-labelledby="connected-apps-heading" className="agent-integrations-section">
        <header>
          <h2 id="connected-apps-heading">Connected apps</h2>
          <IconButton label="Refresh apps" disabled={busy} onClick={() => void act(refresh)}>
            <RefreshCw size={14} />
          </IconButton>
        </header>
        {error ? (
          <p role="alert" className="agent-integrations-description">
            {error}
          </p>
        ) : null}
        {!available ? (
          <p className="agent-integrations-description">
            Connected apps are not set up on this Misty server.
          </p>
        ) : null}
        {signingIn ? (
          <p role="status" className="agent-integrations-description">
            Finish signing in to {signingIn} in your browser, then refresh.
          </p>
        ) : null}
        {apps === null && !error ? (
          <SkeletonList
            label="Connected apps"
            rows={3}
            leading="tile"
            className="agent-integrations-list"
          />
        ) : apps?.length ? (
          <div className="agent-integrations-list">
            {apps.map((item) => (
              <div key={item.id} className="agent-integrations-row">
                <AppLogo app={item.app} size={26} />
                <div className="agent-integrations-row-text">
                  <strong>{item.alias ? `${item.name} · ${item.alias}` : item.name}</strong>
                  {item.status === "needs_attention" ? (
                    <span className="agent-integrations-attention">
                      <CircleAlert size={13} aria-hidden="true" />
                      Needs attention
                    </span>
                  ) : (
                    <span>{item.status === "pending" ? "Waiting for sign-in" : "Connected"}</span>
                  )}
                </div>
                {item.status === "needs_attention" && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void connect(item)}
                  >
                    Reconnect
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void disconnect(item)}
                >
                  Disconnect
                </Button>
              </div>
            ))}
          </div>
        ) : apps ? (
          <p className="agent-integrations-description">No apps connected yet.</p>
        ) : null}
      </section>
      {available ? (
        <section aria-labelledby="add-app-heading" className="agent-integrations-section">
          <header>
            <h2 id="add-app-heading">Add an app</h2>
            <label className="agent-integrations-search">
              <Search size={14} aria-hidden="true" />
              <Input
                variant="bare"
                value={query}
                maxLength={100}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find an app"
                aria-label="Find an app"
              />
            </label>
          </header>
          <div className="agent-integrations-grid">
            {results.map((app) => (
              <div key={app.app} className="agent-integrations-tile" title={app.description}>
                <AppLogo app={app.app} />
                <div className="agent-integrations-row-text">
                  <strong>{app.name}</strong>
                  <span>{app.description}</span>
                </div>
                {app.connected ? (
                  <Check size={14} aria-label="Connected" className="text-cream-muted" />
                ) : (
                  <IconButton
                    label={`Connect ${app.name}`}
                    disabled={busy}
                    onClick={() => void connect(app)}
                  >
                    <Plus size={16} />
                  </IconButton>
                )}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function message(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}
