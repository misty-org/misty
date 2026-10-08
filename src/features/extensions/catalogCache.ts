import type { ExtensionCategory } from "./extensionCategories";
import { extensionsNative } from "./native";
import type { CatalogEntry, CatalogPage } from "./types";

// Firefox Add-ons listings change slowly; serve cached pages instantly and refetch
// in the background once they are older than this.
const freshFor = 10 * 60 * 1000;
const maxEntries = 100;

interface Cached<T> {
  value: T;
  at: number;
}

export interface SearchArgs {
  query: string;
  category: string | null;
  page: number;
  sort: string;
}

const pages = new Map<string, Cached<CatalogPage>>();
const details = new Map<number, Cached<CatalogEntry>>();
const inflight = new Map<string, Promise<unknown>>();
let categories: Promise<ExtensionCategory[]> | null = null;

function remember<K, T>(map: Map<K, Cached<T>>, key: K, value: T, at = Date.now()) {
  map.delete(key);
  map.set(key, { value, at });
  if (map.size > maxEntries) map.delete(map.keys().next().value as K);
}

function once<T>(key: string, load: () => Promise<T>): Promise<T> {
  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;
  const request = load().finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}

const searchKey = (a: SearchArgs) => JSON.stringify([a.query.trim(), a.category, a.page, a.sort]);

/** The cached page for these arguments, and whether it still counts as fresh. */
export function peekSearch(args: SearchArgs) {
  const hit = pages.get(searchKey(args));
  return hit && { value: hit.value, fresh: Date.now() - hit.at < freshFor };
}

export function loadSearch(args: SearchArgs): Promise<CatalogPage> {
  const key = searchKey(args);
  return once(`search:${key}`, async () => {
    const value = await extensionsNative.search(args.query, args.category, args.page, args.sort);
    remember(pages, key, value);
    // Listing entries parse like details, so a detail page opens instantly from them;
    // they are stored as stale so the detail endpoint still confirms them.
    for (const entry of value.entries) {
      if (!details.has(entry.id)) remember(details, entry.id, entry, 0);
    }
    return value;
  });
}

export function peekDetail(id: number) {
  const hit = details.get(id);
  return hit && { value: hit.value, fresh: Date.now() - hit.at < freshFor };
}

export function loadDetail(id: number): Promise<CatalogEntry> {
  return once(`detail:${id}`, async () => {
    const value = await extensionsNative.detail(id);
    remember(details, id, value);
    return value;
  });
}

/** Categories are fetched once per app session; a failure allows a later retry. */
export function loadCategories(): Promise<ExtensionCategory[]> {
  categories ??= extensionsNative.categories().catch((error) => {
    categories = null;
    throw error;
  });
  return categories;
}
