import {
  readCachedResource,
  refreshCachedResource,
  useCachedResource,
} from "@/api/cache/cached-resource";
import { localAppsApi } from "./localApi";

/** An app account connected once; agents use it in every Space. */
export interface ConnectedApp {
  id: string;
  app: string;
  name: string;
  alias?: string;
  /** Who the connection signed in as: an email address or username, when the app reveals it. */
  account?: string;
  status: "active" | "pending" | "needs_attention";
  created_at: string;
  /** Composio's logo for the app, an https address native code fetches. */
  logo?: string;
}

export interface CatalogApp {
  app: string;
  name: string;
  description: string;
  connected: boolean;
  /** Composio's logo for the app, an https address native code fetches. */
  logo?: string;
}

/**
 * What an agent needs from the user to continue: connect an app or approve one action.
 */
export interface AppRequest {
  id: string;
  kind: "connect" | "approve";
  subject: string;
  title: string;
  summary: string;
  state: "pending" | "connected" | "approved" | "used" | "declined" | "expired";
  expiresAt: string;
  /** "Accept and remember" is offered; the label names the exact scope. */
  rememberable?: boolean;
  rememberLabel?: string;
  /** The run's Ask or Auto when it paused. */
  permissionMode?: "ask" | "auto";
  /** A remembered payment covers this merchant up to this amount per payment. */
  paymentCap?: { max_amount_minor: number; currency: string };
}

/** The answer to an approval card: this time only, this time and from now on, or no. */
export type AppRequestDecision = "continue" | "remember" | "deny";

interface ConnectedAppsList {
  available: boolean;
  apps: ConnectedApp[];
}

interface CatalogPage {
  apps: CatalogApp[];
  next_cursor: string;
}

/**
 * The connected apps and the Composio catalog are this computer's, on its own Composio key, so
 * they are kept on this computer. Neither carries a key or token: only names, logos and which
 * account each app signed in as. One copy serves every screen.
 */
const connectedAppsKey = "connected-apps/list";
const catalogKey = (search: string) => `connected-apps/catalog:${search}`;
/** Only the unsearched catalog is saved between launches; a search is kept for this session. */
const catalogPersist = (search: string) => (search ? false : "device");

/** The last copy of a resource: this session's, else the one saved on this computer. */
function savedCopy<T>(key: string, persisted: boolean): Promise<T | undefined> {
  return readCachedResource<T>(key, persisted ? "device" : false);
}

/**
 * Asks afresh through the shared cache, so every screen showing it gets the answer; `onCached`
 * gets the last copy first, unless the fresh one came before it.
 */
function cachedLoad<T>(
  key: string,
  loader: () => Promise<T>,
  persist: "device" | false,
  onCached?: (value: T) => void,
): Promise<T> {
  let answered = false;
  const fresh = refreshCachedResource(key, loader, persist).finally(() => {
    answered = true;
  });
  if (onCached) {
    void savedCopy<T>(key, Boolean(persist)).then((saved) => {
      if (saved !== undefined && !answered) onCached(saved);
    });
  }
  return fresh;
}

/** The connected apps, for a screen: the last list paints at once and a fresh one follows. */
export const useConnectedApps = () =>
  useCachedResource(connectedAppsKey, () => localAppsApi.list(), { persist: "device" });

/** The catalog's first page for `search`, for a screen; `null` holds off. */
export const useAppsCatalog = (search: string | null) =>
  useCachedResource(
    search === null ? null : catalogKey(search),
    () => localAppsApi.catalog(search ?? ""),
    { persist: catalogPersist(search ?? "") },
  );

/** Connected apps run on this computer's Composio key. */
export const appsApi = {
  list: (onCached?: (value: ConnectedAppsList) => void) =>
    cachedLoad(connectedAppsKey, () => localAppsApi.list(), "device", onCached),
  catalog: (search: string, cursor = "", onCached?: (value: CatalogPage) => void) =>
    // Only the first page is kept; later ones are asked for each time.
    cursor
      ? localAppsApi.catalog(search, cursor)
      : cachedLoad(
          catalogKey(search),
          () => localAppsApi.catalog(search),
          catalogPersist(search),
          onCached,
        ),
  connect: (app: string) => localAppsApi.connect(app),
  disconnect: (id: string) => localAppsApi.disconnect(id),
  request: (id: string) => localAppsApi.request(id),
  requestLink: (id: string) => localAppsApi.requestLink(id),
  decide: (id: string, decision: AppRequestDecision) => localAppsApi.decide(id, decision),
};
