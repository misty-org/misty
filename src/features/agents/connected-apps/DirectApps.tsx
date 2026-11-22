import { Unplug } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useCachedResource } from "@/api/cache/cached-resource";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import {
  Button,
  CatalogDone,
  DisclosureButton,
  ErrorState,
  LogoTile,
  MenuItem,
  SearchField,
  Shelf,
  ShelfItem,
  ShelfSkeleton,
  useNotice,
  Text,
} from "@misty/ui";
import { DirectAppLogo } from "./DirectAppLogo";
import {
  directAppsApi,
  listenDirectApps,
  type DirectAccess,
  type DirectCatalogApp,
  type DirectConnection,
} from "./directApi";

const message = (reason: unknown, fallback: string) =>
  reason instanceof Error ? reason.message : fallback;

/**
 * The apps a person can connect directly: each one signs in on the app maker's own page, and every
 * engine can then use it. Only apps whose sign-in needs no key of Misty's are shown: the shipped
 * catalog was checked when it was built, and anything newer is checked before it appears. Apps
 * load a page at a time; `limit` shows that many until the person asks for more. They are one
 * store shelf; with `query` the page's own search finds them and the shelf draws no field.
 */
export function DirectApps({
  limit,
  find = "",
  query: outside,
}: {
  limit?: number;
  find?: string;
  query?: string;
}) {
  const [typed, setQuery] = useState(find);
  const query = outside ?? typed;
  // A new link's search replaces what was typed.
  useEffect(() => {
    if (find) setQuery(find);
  }, [find]);
  // A typed search waits for a pause; browsing loads at once.
  const [term, setTerm] = useState(() => query.trim());
  useEffect(() => {
    const next = query.trim();
    if (next === term) return;
    const timer = window.setTimeout(() => setTerm(next), next ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [query, term]);
  // The first page of each search, and the connected apps (names only: the tokens stay in the
  // keychain), paint from the last copy and are asked again behind it. Only the unsearched page
  // and the connections are kept between launches.
  const firstPage = useCachedResource(
    `direct-apps/catalog:${term}`,
    () => directAppsApi.catalog(term, 0),
    { persist: term ? false : "device" },
  );
  const connectionsList = useCachedResource("direct-apps/connections", () => directAppsApi.list(), {
    persist: "device",
  });
  // A new search keeps the last apps on screen until its own arrive.
  const [lastPage, setLastPage] = useState(firstPage.data);
  if (firstPage.data && firstPage.data !== lastPage) setLastPage(firstPage.data);
  const page = firstPage.data ?? lastPage;
  /** Pages past the first, loaded with Show more, for the search they were loaded for. */
  const [more, setMore] = useState<{
    term: string;
    apps: DirectCatalogApp[];
    total: number;
  } | null>(null);
  const extra = more?.term === term && firstPage.data ? more : null;
  const catalog = useMemo(() => {
    if (!page) return null;
    if (!extra) return page.apps;
    const known = new Set(page.apps.map((app) => app.url));
    return [...page.apps, ...extra.apps.filter((app) => !known.has(app.url))];
  }, [page, extra]);
  const total = extra?.total ?? page?.total ?? 0;
  const [loadingMore, setLoadingMore] = useState(false);
  const [access, setAccess] = useState<Record<string, DirectAccess>>({});
  const connections = connectionsList.data ?? null;
  const [pending, setPending] = useState<{ url: string; name: string } | null>(null);
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState("");
  // A list that never came says so in its place; one on screen stays beside a failed refresh.
  const loadError =
    (!connectionsList.data && !connectionsList.loading && connectionsList.error
      ? message(connectionsList.error, "Connected apps could not be loaded.")
      : "") ||
    (!page && !firstPage.loading && firstPage.error
      ? message(firstPage.error, "The app list could not be loaded.")
      : "");
  const retryLoad = () => {
    if (!connectionsList.data) void connectionsList.reload();
    if (!page) void firstPage.reload();
  };
  const loadConnections = connectionsList.reload;

  // The shipped apps loaded so far: the next page starts after them.
  const loadedShipped = (catalog ?? []).filter((app) => app.checked).length;
  const loadMore = async () => {
    if (loadingMore || !catalog) return;
    setLoadingMore(true);
    try {
      const next = await directAppsApi.catalog(term, loadedShipped);
      setMore((current) => {
        const kept = current?.term === term ? current.apps : [];
        const known = new Set(kept.map((app) => app.url));
        return {
          term,
          apps: [...kept, ...next.apps.filter((app) => !known.has(app.url))],
          total: next.total,
        };
      });
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

  useNotice(Boolean(error), { message: error, tone: "error" });
  const title = "Connect an app";
  const line = (text: string) => (
    <li className="pt-2 lg:col-span-2">
      <Text as="p" size="meta" tone="muted" wrap className="m-0">
        {text}
      </Text>
    </li>
  );
  return (
    <div className="grid gap-2">
      {outside === undefined ? (
        <SearchField
          value={query}
          maxLength={100}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={
            total > 100 && !needle ? `Find among ${total.toLocaleString()} apps` : "Find an app"
          }
          aria-label="Find an app"
        />
      ) : null}
      {loadError ? (
        <ErrorState
          inline
          title="Apps couldn't load"
          line={loadError}
          action={{ label: "Try again", variant: "secondary", onClick: retryLoad }}
        />
      ) : loading ? (
        <ShelfSkeleton label={title} />
      ) : (
        <Shelf title={title}>
          {pending
            ? line(`Finish signing in to ${pending.name} in your browser, then come back here.`)
            : null}
          {own.map((connection) => (
            <ShelfItem
              key={connection.id}
              logo={
                <AppTileLogo
                  app={connection.app}
                  name={connection.name}
                  icon={byUrl.get(connection.url)?.icon}
                />
              }
              title={connection.name}
              line={byUrl.get(connection.url)?.description}
              action={<CatalogDone label="Connected" />}
              menu={
                <MenuItem
                  icon={Unplug}
                  label="Disconnect"
                  onSelect={() => void disconnect(connection)}
                />
              }
            />
          ))}
          {shown.map((app) => (
            <ShelfItem
              key={app.url}
              logo={<AppTileLogo app={app.app} name={app.name} icon={app.icon} />}
              title={app.name}
              line={app.description}
              action={
                <Button
                  variant="get"
                  size="sm"
                  aria-label={`Connect ${app.name}`}
                  disabled={pending?.url === app.url}
                  onClick={() => void connect(app)}
                >
                  Connect
                </Button>
              }
            />
          ))}
          {!checking && !own.length && !offered.length
            ? line("No app by that name takes a direct sign-in yet.")
            : null}
        </Shelf>
      )}
      {notShown > 0 && !loading ? (
        <DisclosureButton
          open={false}
          disabled={loadingMore}
          onClick={() => {
            if (folded) setOpened(true);
            else void loadMore();
          }}
        >
          {folded ? `${notShown.toLocaleString()} more apps` : "Show more"}
        </DisclosureButton>
      ) : null}
    </div>
  );
}

function AppTileLogo({ app, name, icon }: { app: string; name: string; icon?: string }) {
  return (
    <LogoTile size="tile">
      <DirectAppLogo app={app} name={name} icon={icon} size={40} />
    </LogoTile>
  );
}
