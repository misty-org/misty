import { Check, Plus, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { confirmAction } from "@/shared/lib/confirmAction";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import {
  Button,
  IconButton,
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
  SearchField,
  Skeleton,
  SkeletonControl,
  Text,
  Tooltip,
  useNotice,
} from "@/shared/ui";
import { modelKeysChangedEvent, openModelSettings } from "@/features/agents/modelKeysPublic";
import {
  appsApi,
  useAppsCatalog,
  useConnectedApps,
  type CatalogApp,
  type ConnectedApp,
} from "./api";
import { AppAccountsCard, AppLogo, accountSummary, groupApps } from "./ConnectedAppRows";
import { DirectApps } from "./DirectApps";

/** A sign-in open in the browser, and the accounts that app already had when it began. */
interface SignIn {
  app: string;
  name: string;
  known: string[];
}

/** Account-wide connected apps. Every agent can use them; nothing is set per agent. */
export function ConnectedAppsCatalog({ find = "" }: { find?: string } = {}) {
  // The saved lists paint at once, from this session or the last one; fresh ones follow behind.
  const listing = useConnectedApps();
  const apps: ConnectedApp[] | null = useMemo(
    () => listing.data?.apps ?? (listing.loading ? null : []),
    [listing.data?.apps, listing.loading],
  );
  const available = listing.data?.available ?? true;
  const [query, setQuery] = useState("");
  // A typed search waits for a pause before it asks.
  const [term, setTerm] = useState("");
  useEffect(() => {
    const next = query.trim();
    if (next === term) return;
    const timer = window.setTimeout(() => setTerm(next), 250);
    return () => window.clearTimeout(timer);
  }, [query, term]);
  const catalog = useAppsCatalog(available ? term : null);
  // A new search keeps the last results on screen until its own arrive.
  const [lastResults, setLastResults] = useState<CatalogApp[] | undefined>(catalog.data?.apps);
  if (catalog.data && catalog.data.apps !== lastResults) setLastResults(catalog.data.apps);
  const results: CatalogApp[] = catalog.data?.apps ?? lastResults ?? [];
  const [signingIn, setSigningIn] = useState<SignIn | null>(null);
  const [busy, setBusy] = useState(false);
  const [openApp, setOpenApp] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  // A list that never came says so; one that came stays on screen beside a failed refresh.
  const error =
    actionError ||
    (listing.error && !listing.data ? message(listing.error, "Apps could not be loaded.") : "") ||
    (available && catalog.error && !catalog.data && !lastResults
      ? message(catalog.error, "The app list could not be loaded.")
      : "");
  const setError = setActionError;

  const { reload: reloadApps } = listing;
  const { reload: reloadCatalog } = catalog;
  const refresh = reloadApps;
  // Refresh asks again behind the grid, which stays as it is until the answers arrive.
  const reload = async () => {
    await Promise.all([reloadApps(), reloadCatalog()]);
  };
  // A Composio key saved in Settings takes effect here at once.
  useEffect(() => {
    const check = () => void refresh().catch(() => undefined);
    window.addEventListener(modelKeysChangedEvent, check);
    return () => window.removeEventListener(modelKeysChangedEvent, check);
  }, [refresh]);
  // While a sign-in is open in the browser, check once each time Misty regains focus.
  useEffect(() => {
    if (!signingIn) return;
    let stopped = false;
    // The shared list updates every screen showing it, this one too.
    const check = () => {
      if (!stopped) void appsApi.list().catch(() => undefined);
    };
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
    void reloadCatalog();
  }, [apps, signingIn, reloadCatalog]);

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
      await reloadCatalog();
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
  useNotice(Boolean(error), { message: error, tone: "error" });
  return (
    <>
      <section aria-labelledby="direct-apps-heading" className="agent-integrations-section">
        <header>
          <h2 id="direct-apps-heading">Sign in directly</h2>
        </header>
        <DirectApps find={find} />
      </section>
      {/* Unavailable only means no Composio key on this computer: apps never go through the server. */}
      {!available ? (
        <div className="agent-integrations-description grid justify-items-start gap-2">
          <p>Add a Composio key for apps that don’t offer a direct sign-in, such as Gmail.</p>
          <Button onClick={openModelSettings}>Open Models</Button>
        </div>
      ) : null}
      {signingIn ? (
        <p role="status" className="agent-integrations-description">
          Finish signing in to {signingIn.name} in your browser, then come back to Misty.
        </p>
      ) : null}
      {available ? (
        <section aria-labelledby="add-app-heading" className="agent-integrations-section">
          <header>
            <h2 id="add-app-heading">Through Composio</h2>
            <div className="flex items-center gap-2">
              <SearchField
                containerClassName="agent-integrations-search"
                value={query}
                maxLength={100}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find an app"
                aria-label="Find an app"
              />
              <IconButton label="Refresh apps" disabled={busy} onClick={() => void act(reload)}>
                <RefreshCw />
              </IconButton>
            </div>
          </header>
          {apps === null || (catalog.loading && !lastResults) ? (
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
                  <SkeletonControl kind="icon" />
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
                      variant="quiet"
                      className="agent-integrations-tile agent-integrations-tile-button"
                      aria-label={`${group.name}, ${accountSummary(group)}. Show accounts`}
                    >
                      <AppLogo app={group.app} name={group.name} logo={group.logo} />
                      <div className="agent-integrations-row-text">
                        <strong>{group.name}</strong>
                        <span>{accountSummary(group)}</span>
                      </div>
                      <Text bare tone="muted" className="flex">
                        <Check aria-hidden="true" />
                      </Text>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" size="lg">
                    <PopoverHeader title={group.name} />
                    <PopoverBody>
                      <AppAccountsCard
                        group={group}
                        onDone={() => setOpenApp(null)}
                        {...accountActions}
                      />
                    </PopoverBody>
                  </PopoverContent>
                </Popover>
              ))}
              {rest.map((app) => (
                <Tooltip key={app.app} content={app.description}>
                  <div className="agent-integrations-tile">
                    <AppLogo app={app.app} name={app.name} logo={app.logo} />
                    <div className="agent-integrations-row-text">
                      <strong>{app.name}</strong>
                      <span>{app.description}</span>
                    </div>
                    <IconButton
                      label={`Connect ${app.name}`}
                      disabled={busy}
                      onClick={() => void connect(app)}
                    >
                      <Plus />
                    </IconButton>
                  </div>
                </Tooltip>
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
