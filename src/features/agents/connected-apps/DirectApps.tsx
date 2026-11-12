import { Check, ChevronDown, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  ErrorNotification,
  IconButton,
  SearchField,
  Skeleton,
} from "@/shared/ui";
import { DirectAppLogo } from "./DirectAppLogo";
import {
  directAppsApi,
  listenDirectApps,
  type DirectAccess,
  type DirectCatalogApp,
  type DirectConnection,
} from "./directApi";

const tileClass =
  "flex min-h-10 items-center gap-2.5 rounded-md px-2 py-1 transition-colors hover:bg-charcoal-hover";

const message = (reason: unknown, fallback: string) =>
  reason instanceof Error ? reason.message : fallback;

/**
 * The apps a person can connect directly: each one signs in on the app maker's own page, and every
 * engine can then use it. Only apps whose sign-in needs no key of Misty's are shown: the shipped
 * catalog was checked when it was built, and anything newer is checked before it appears. Apps
 * load a page at a time; `limit` shows that many until the person asks for more.
 */
export function DirectApps({ limit, find = "" }: { limit?: number; find?: string }) {
  const [query, setQuery] = useState(find);
  // A new link's search replaces what was typed.
  useEffect(() => {
    if (find) setQuery(find);
  }, [find]);
  const [catalog, setCatalog] = useState<DirectCatalogApp[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [access, setAccess] = useState<Record<string, DirectAccess>>({});
  const [connections, setConnections] = useState<DirectConnection[] | null>(null);
  const [pending, setPending] = useState<{ url: string; name: string } | null>(null);
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState("");

  const loadConnections = useCallback(async () => {
    try {
      setConnections(await directAppsApi.list());
    } catch (reason) {
      setConnections([]);
      setError(message(reason, "Connected apps could not be loaded."));
    }
  }, []);
  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  // A typed search waits for a pause; browsing loads at once.
  useEffect(() => {
    let live = true;
    const term = query.trim();
    const timer = window.setTimeout(
      () => {
        setCatalog(null);
        directAppsApi
          .catalog(term, 0)
          .then((page) => {
            if (!live) return;
            setCatalog(page.apps);
            setTotal(page.total);
          })
          .catch((reason: unknown) => {
            if (!live) return;
            setCatalog([]);
            setTotal(0);
            setError(message(reason, "The app list could not be loaded."));
          });
      },
      term ? 300 : 0,
    );
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  // The shipped apps loaded so far: the next page starts after them.
  const loadedShipped = (catalog ?? []).filter((app) => app.checked).length;
  const loadMore = async () => {
    if (loadingMore || !catalog) return;
    setLoadingMore(true);
    try {
      const page = await directAppsApi.catalog(query.trim(), loadedShipped);
      setCatalog((current) => {
        const known = new Set((current ?? []).map((app) => app.url));
        return [...(current ?? []), ...page.apps.filter((app) => !known.has(app.url))];
      });
      setTotal(page.total);
    } catch (reason) {
      setError(message(reason, "More apps could not be loaded."));
    } finally {
      setLoadingMore(false);
    }
  };

  // An app newer than the shipped catalog is checked once; one that would need a key of Misty's
  // never shows.
  useEffect(() => {
    const unchecked = (catalog ?? [])
      .filter((app) => !app.checked && !(app.url in access))
      .map((app) => app.url);
    if (!unchecked.length) return;
    let live = true;
    const settle = (found: Record<string, DirectAccess>) => {
      if (!live) return;
      const settled = Object.fromEntries(
        unchecked.map((url) => [url, found[url] ?? "unreachable"] as const),
      );
      setAccess((current) => ({ ...current, ...settled }));
    };
    directAppsApi
      .check(unchecked)
      .then(settle)
      .catch(() => settle({}));
    return () => {
      live = false;
    };
  }, [catalog, access]);

  useEffect(() => {
    const stop = listenDirectApps((outcome) => {
      setPending(null);
      if (!outcome.ok) setError(outcome.message ?? "The sign-in didn’t finish.");
      void loadConnections();
    });
    return () => {
      void stop.then((unlisten) => unlisten());
    };
  }, [loadConnections]);

  const connect = async (app: DirectCatalogApp) => {
    setError("");
    try {
      const { url } = await directAppsApi.connect(app.url, app.name);
      setPending({ url: app.url, name: app.name });
      await openExternalLink(url);
    } catch (reason) {
      setPending(null);
      setError(message(reason, `${app.name} couldn’t be connected.`));
    }
  };
  const disconnect = async (connection: DirectConnection) => {
    setError("");
    try {
      await directAppsApi.disconnect(connection.id);
      await loadConnections();
    } catch (reason) {
      setError(message(reason, `${connection.name} couldn’t be disconnected.`));
    }
  };

  const byUrl = useMemo(
    () => new Map((catalog ?? []).map((app) => [app.url, app] as const)),
    [catalog],
  );
  const connectedUrls = new Set((connections ?? []).map((item) => item.url));
  // Connected apps lead, then the ones that take a keyless sign-in.
  const offered = (catalog ?? []).filter(
    (app) => !connectedUrls.has(app.url) && (app.checked || access[app.url] === "keyless"),
  );
  const checking = (catalog ?? []).filter((app) => !app.checked && !(app.url in access)).length;
  const needle = query.trim().toLowerCase();
  const own = (connections ?? []).filter(
    (item) => !needle || item.name.toLowerCase().includes(needle),
  );
  const folded = Boolean(limit) && !opened && !needle;
  const shown = folded ? offered.slice(0, Math.max(0, (limit ?? 0) - own.length)) : offered;
  // What isn't on screen yet: the rest of this page, then the catalog's unloaded matches.
  const notShown = offered.length - shown.length + Math.max(0, total - loadedShipped);
  const loading = catalog === null || connections === null;

  return (
    <div className="grid gap-2">
      <ErrorNotification message={error} />
      <SearchField
        size="md"
        value={query}
        maxLength={100}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={
          total > 100 && !needle ? `Find among ${total.toLocaleString()} apps` : "Find an app"
        }
        aria-label="Find an app"
      />
      {pending ? (
        <p role="status" className="text-sm text-cream-muted">
          Finish signing in to {pending.name} in your browser, then come back here.
        </p>
      ) : null}
      <ul
        aria-label="Apps"
        aria-busy={loading || checking > 0}
        className="grid grid-cols-2 gap-x-4 gap-y-0.5"
      >
        {own.map((connection) => (
          <li key={connection.id} className={tileClass}>
            <AppTileLogo
              app={connection.app}
              name={connection.name}
              icon={byUrl.get(connection.url)?.icon}
            />
            <p className="min-w-0 flex-1 truncate text-sm font-medium text-cream-bright">
              {connection.name}
            </p>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label={`${connection.name} connected`}>
                  <Check size={16} />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void disconnect(connection)}>
                  Disconnect
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ))}
        {shown.map((app) => (
          <li key={app.url} className={tileClass} title={app.description || undefined}>
            <AppTileLogo app={app.app} name={app.name} icon={app.icon} />
            <p className="min-w-0 flex-1 truncate text-sm font-medium text-cream-bright">
              {app.name}
            </p>
            <IconButton
              label={`Connect ${app.name}`}
              disabled={pending?.url === app.url}
              onClick={() => void connect(app)}
            >
              <Plus size={16} />
            </IconButton>
          </li>
        ))}
        {loading || checking > 0 || loadingMore
          ? Array.from(
              { length: loading ? 6 : loadingMore ? 4 : Math.min(checking, 4) },
              (_, index) => (
                <li key={`skeleton-${index}`} className={tileClass} aria-hidden="true">
                  <Skeleton className="size-7 shrink-0 rounded-md" />
                  <Skeleton className="h-3 w-1/2" />
                </li>
              ),
            )
          : null}
      </ul>
      {!loading && !checking && !own.length && !offered.length ? (
        <p className="text-sm text-cream-muted">No app by that name takes a direct sign-in yet.</p>
      ) : null}
      {notShown > 0 && !loading ? (
        <Button
          variant="ghost"
          size="sm"
          className="justify-self-start text-cream-muted"
          disabled={loadingMore}
          onClick={() => {
            if (folded) setOpened(true);
            else void loadMore();
          }}
        >
          <ChevronDown />
          {folded ? `${notShown.toLocaleString()} more apps` : "Show more"}
        </Button>
      ) : null}
    </div>
  );
}

function AppTileLogo({ app, name, icon }: { app: string; name: string; icon?: string }) {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-charcoal-hover">
      <DirectAppLogo app={app} name={name} icon={icon} size={16} />
    </span>
  );
}
