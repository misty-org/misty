import { Check, Plus, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { confirmAction } from "@/shared/lib/confirmAction";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import { IconButton, Input, SkeletonList } from "@/shared/ui";
import { appsApi, type CatalogApp, type ConnectedApp } from "./api";
import { AppLogo, ConnectedAppGroup, groupApps } from "./ConnectedAppRows";

/** A sign-in open in the browser, and the accounts that app already had when it began. */
interface SignIn {
  app: string;
  name: string;
  known: string[];
}

/** Account-wide connected apps. Every agent can use them; nothing is set per agent. */
export function ConnectedAppsCatalog() {
  const [apps, setApps] = useState<ConnectedApp[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogApp[]>([]);
  const [signingIn, setSigningIn] = useState<SignIn | null>(null);
  const [catalogVersion, setCatalogVersion] = useState(0);
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
  }, [query, available, catalogVersion]);
  // While a sign-in is open in the browser, check once each time Misty regains focus.
  useEffect(() => {
    if (!signingIn) return;
    let stopped = false;
    const check = () =>
      void appsApi
        .list()
        .then((result) => {
          if (stopped) return;
          setAvailable(result.available);
          setApps(result.apps);
        })
        .catch(() => undefined);
    window.addEventListener("focus", check);
    return () => {
      stopped = true;
      window.removeEventListener("focus", check);
    };
  }, [signingIn]);
  useEffect(() => {
    if (!signingIn) return;
    const { app, known } = signingIn;
    const done = apps?.some(
      (item) => item.app === app && item.status === "active" && !known.includes(item.id),
    );
    if (!done) return;
    setSigningIn(null);
    setCatalogVersion((version) => version + 1);
  }, [apps, signingIn]);

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
      const known = (apps ?? [])
        .filter((item) => item.app === app.app && item.status === "active")
        .map((item) => item.id);
      setSigningIn({ app: app.app, name: app.name, known });
    });
  const disconnect = (item: ConnectedApp, label: string) =>
    act(async () => {
      if (
        !(await confirmAction(
          `Disconnect ${label}? Agents lose access right away.`,
          "Disconnect app",
        ))
      )
        return;
      await appsApi.disconnect(item.id);
      await refresh();
      setCatalogVersion((version) => version + 1);
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
            Finish signing in to {signingIn.name} in your browser, then come back to Misty.
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
            {groupApps(apps).map((group) => (
              <ConnectedAppGroup
                key={group.app}
                group={group}
                busy={busy}
                onAdd={(next) => void connect(next)}
                onReconnect={(item) => void connect(item)}
                onDisconnect={(item, label) => void disconnect(item, label)}
              />
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
