import { Check, Plus, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { confirmAction } from "@/shared/lib/confirmAction";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import {
  Button,
  IconButton,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
} from "@/shared/ui";
import { appsApi, type CatalogApp, type ConnectedApp } from "./api";
import { AppAccountsCard, AppLogo, accountSummary, groupApps } from "./ConnectedAppRows";

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
  /** The Refresh button was pressed: the grid shows skeletons until the apps are back. */
  const [refreshing, setRefreshing] = useState(false);
  const [openApp, setOpenApp] = useState<string | null>(null);
  const [error, setError] = useState("");

  const reload = async () => {
    setRefreshing(true);
    try {
      const [list, catalog] = await Promise.all([appsApi.list(), appsApi.catalog(query.trim())]);
      setAvailable(list.available);
      setApps(list.apps);
      setResults(catalog.apps);
    } finally {
      setRefreshing(false);
    }
  };
  const refresh = useCallback(async () => {
    const result = await appsApi.list();
    setAvailable(result.available);
    setApps(result.apps);
  }, []);
  useEffect(() => {
    let live = true;
    const show = (result: { available: boolean; apps: ConnectedApp[] }) => {
      if (!live) return;
      setAvailable(result.available);
      setApps(result.apps);
    };
    // The saved list paints at once; the fresh one follows.
    appsApi
      .list(show)
      .then(show)
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
        .catalog(query.trim(), "", (saved) => live && setResults(saved.apps))
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

  const groups = groupApps(apps ?? []);
  const needle = query.trim().toLowerCase();
  // Connected apps lead the grid, found even when the catalog page doesn't list them.
  const connected = groups.filter(
    (group) =>
      !needle ||
      group.name.toLowerCase().includes(needle) ||
      group.app.toLowerCase().includes(needle),
  );
  const rest = results.filter((app) => !groups.some((group) => group.app === app.app));
  const accountActions = {
    busy,
    onAdd: (next: { app: string; name: string }) => void connect(next),
    onReconnect: (item: ConnectedApp) => void connect(item),
    onDisconnect: (item: ConnectedApp, label: string) => void disconnect(item, label),
  };
  return (
    <>
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
      {available ? (
        <section aria-labelledby="add-app-heading" className="agent-integrations-section">
          <header>
            <h2 id="add-app-heading">Apps</h2>
            <div className="flex items-center gap-2">
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
              <IconButton label="Refresh apps" disabled={busy} onClick={() => void act(reload)}>
                <RefreshCw size={14} />
              </IconButton>
            </div>
          </header>
          {(apps === null && !error) || refreshing ? (
            <div
              role="status"
              aria-label="Apps"
              aria-busy="true"
              className="agent-integrations-grid"
            >
              <span className="sr-only">Apps</span>
              {Array.from({ length: 12 }, (_, index) => (
                <div key={index} className="agent-integrations-tile">
                  <Skeleton className="size-6 shrink-0 rounded-md" />
                  <div className="grid min-w-0 flex-1 gap-1.5">
                    <Skeleton className="h-3 w-1/2" />
                    <Skeleton className="h-2.5 w-4/5" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="agent-integrations-grid">
              {connected.map((group) => (
                <Popover
                  key={group.app}
                  open={openApp === group.app}
                  onOpenChange={(next) => setOpenApp(next ? group.app : null)}
                >
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      className="agent-integrations-tile agent-integrations-tile-button"
                      aria-label={`${group.name}, ${accountSummary(group)}. Show accounts`}
                    >
                      <AppLogo app={group.app} />
                      <div className="agent-integrations-row-text">
                        <strong>{group.name}</strong>
                        <span>{accountSummary(group)}</span>
                      </div>
                      <Check size={14} aria-hidden="true" className="text-cream-muted" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-80 p-2">
                    <AppAccountsCard
                      group={group}
                      onDone={() => setOpenApp(null)}
                      {...accountActions}
                    />
                  </PopoverContent>
                </Popover>
              ))}
              {rest.map((app) => (
                <div key={app.app} className="agent-integrations-tile" title={app.description}>
                  <AppLogo app={app.app} />
                  <div className="agent-integrations-row-text">
                    <strong>{app.name}</strong>
                    <span>{app.description}</span>
                  </div>
                  <IconButton
                    label={`Connect ${app.name}`}
                    disabled={busy}
                    onClick={() => void connect(app)}
                  >
                    <Plus size={16} />
                  </IconButton>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}

function message(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}
