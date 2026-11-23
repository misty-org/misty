import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { readApiAccountId } from "@/api/client/session";
import { readApiCache, writeApiCache } from "./api_cache";

export type CachePersistence = "device" | "account" | false;

const DEVICE_SCOPE = "device";

interface Entry {
  value?: unknown;
  hasValue: boolean;
  fetchedAt?: number;
  error?: unknown;
  running?: Promise<unknown>;
  restored: boolean;
  generation: number;
}

const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();
const watchedLoaders = new Map<
  string,
  { loader: () => Promise<unknown>; persist: CachePersistence; watchers: number }
>();

export function refreshWatchedCachedResources(prefix: string): Promise<void> {
  const reads: Promise<unknown>[] = [];
  for (const [key, watched] of watchedLoaders) {
    if (!key.startsWith(prefix)) continue;
    reads.push(load(key, watched.loader, watched.persist, false).catch(() => undefined));
  }
  return Promise.all(reads).then(() => undefined);
}

function entry(key: string): Entry {
  let found = entries.get(key);
  if (!found) {
    found = { hasValue: false, restored: false, generation: 0 };
    entries.set(key, found);
  }
  return found;
}

function changed(key: string) {
  const current = entries.get(key);
  if (current) entries.set(key, { ...current });
  for (const listener of listeners.get(key) ?? []) listener();
}

function scopeOf(persist: CachePersistence): string | null {
  if (persist === "device") return DEVICE_SCOPE;
  if (persist === "account") return readApiAccountId() || null;
  return null;
}

const savedKey = (key: string) => `resource:${key}`;

async function restore(key: string, persist: CachePersistence) {
  const current = entry(key);
  if (current.restored) return;
  current.restored = true;
  const scope = scopeOf(persist);
  if (!scope) return;
  const hit = await readApiCache(scope, savedKey(key));
  if (!hit || entry(key).hasValue) return;
  try {
    Object.assign(entry(key), {
      value: JSON.parse(hit.body),
      hasValue: true,
      fetchedAt: hit.fetchedAt,
    });
    changed(key);
  } catch {}
}

function load<T>(
  key: string,
  loader: () => Promise<T>,
  persist: CachePersistence,
  join: boolean,
): Promise<T> {
  const current = entry(key);
  if (current.running && join) return current.running as Promise<T>;
  const generation = current.generation + 1;
  const newest = () => entry(key).generation === generation;
  const scope = scopeOf(persist);
  const running = loader().then(
    (value) => {
      if (!newest()) return value;
      Object.assign(entry(key), {
        value,
        hasValue: true,
        fetchedAt: Date.now(),
        error: undefined,
        running: undefined,
      });
      changed(key);
      if (scope) void writeApiCache(scope, savedKey(key), JSON.stringify(value ?? null));
      return value;
    },
    (error: unknown) => {
      if (newest()) {
        Object.assign(entry(key), { error, running: undefined });
        changed(key);
      }
      throw error;
    },
  );
  Object.assign(current, { running, generation });
  changed(key);
  return running;
}

export function setCachedResource<T>(
  key: string,
  next: T | ((previous: T | undefined) => T),
  persist: CachePersistence = false,
) {
  const current = entry(key);
  const value =
    typeof next === "function"
      ? (next as (previous: T | undefined) => T)(current.value as T | undefined)
      : next;
  Object.assign(current, {
    value,
    hasValue: true,
    fetchedAt: Date.now(),
    error: undefined,
    running: undefined,
    generation: current.generation + 1,
  });
  changed(key);
  const scope = scopeOf(persist);
  if (scope) void writeApiCache(scope, savedKey(key), JSON.stringify(value ?? null));
}

export async function readCachedResource<T>(
  key: string,
  persist: CachePersistence = false,
): Promise<T | undefined> {
  const warm = entries.get(key);
  if (warm?.hasValue) return warm.value as T;
  const scope = scopeOf(persist);
  if (!scope) return undefined;
  const hit = await readApiCache(scope, savedKey(key));
  if (!hit) return undefined;
  try {
    return JSON.parse(hit.body) as T;
  } catch {
    return undefined;
  }
}

export function peekCachedResource<T>(key: string): T | undefined {
  return entries.get(key)?.value as T | undefined;
}

export function refreshCachedResource<T>(
  key: string,
  loader: () => Promise<T>,
  persist: CachePersistence = false,
  options: { join?: boolean } = {},
): Promise<T> {
  return load(key, loader, persist, options.join ?? false);
}

export function clearCachedResources() {
  entries.clear();
  for (const set of listeners.values()) for (const listener of set) listener();
}

export interface CachedResource<T> {
  data: T | undefined;
  fetchedAt: number | undefined;
  error: unknown;
  loading: boolean;
  refreshing: boolean;
  reload: (options?: { force?: boolean }) => Promise<T | undefined>;
  set: (next: T | ((previous: T | undefined) => T)) => void;
}

export function useCachedResource<T>(
  key: string | null,
  loader: () => Promise<T>,
  options: { persist?: CachePersistence } = {},
): CachedResource<T> {
  const persist = options.persist ?? false;
  const snapshot = useSyncExternalStore(
    useCallback(
      (listener: () => void) => {
        if (!key) return () => {};
        let set = listeners.get(key);
        if (!set) listeners.set(key, (set = new Set()));
        set.add(listener);
        return () => {
          set.delete(listener);
        };
      },
      [key],
    ),
    () => (key ? entries.get(key) : undefined),
  );

  const latestLoader = useLatest(loader);
  useEffect(() => {
    if (!key) return;
    void restore(key, persist);
    load(key, () => latestLoader.current(), persist, true).catch(() => {});
    const watched = watchedLoaders.get(key);
    const run = () => latestLoader.current();
    watchedLoaders.set(key, { loader: run, persist, watchers: (watched?.watchers ?? 0) + 1 });
    return () => {
      const current = watchedLoaders.get(key);
      if (!current) return;
      if (current.watchers <= 1) watchedLoaders.delete(key);
      else watchedLoaders.set(key, { ...current, watchers: current.watchers - 1 });
    };
  }, [key, persist, latestLoader]);

  const reload = useCallback(
    async (_options: { force?: boolean } = {}) => {
      if (!key) return undefined;
      try {
        return await load(key, () => latestLoader.current(), persist, false);
      } catch {
        return entries.get(key)?.value as T | undefined;
      }
    },
    [key, persist, latestLoader],
  );

  const set = useCallback(
    (next: T | ((previous: T | undefined) => T)) => {
      if (key) setCachedResource(key, next, persist);
    },
    [key, persist],
  );

  const hasValue = snapshot?.hasValue ?? false;
  const running = Boolean(snapshot?.running);
  return {
    data: snapshot?.value as T | undefined,
    fetchedAt: snapshot?.fetchedAt,
    error: snapshot?.error,
    loading: Boolean(key) && !hasValue && (running || !snapshot?.error),
    refreshing: running && hasValue,
    reload,
    set,
  };
}

export interface CachedResourceRead<T> {
  data: T | undefined;
  error: unknown;
}

export function useCachedResources<T>(
  keys: readonly string[],
  loader: (key: string) => Promise<T>,
  options: { persist?: CachePersistence; load?: boolean } = {},
): Readonly<Record<string, CachedResourceRead<T>>> {
  const persist = options.persist ?? false;
  const loadNow = options.load ?? true;
  const id = keys.join("\n");
  const last = useRef<{
    id: string;
    seen: (Entry | undefined)[];
    value: Record<string, CachedResourceRead<T>>;
  }>({ id: "", seen: [], value: {} });
  const snapshot = useSyncExternalStore(
    useCallback(
      (listener: () => void) => {
        const watched = id ? id.split("\n") : [];
        for (const key of watched) {
          let set = listeners.get(key);
          if (!set) listeners.set(key, (set = new Set()));
          set.add(listener);
        }
        return () => {
          for (const key of watched) listeners.get(key)?.delete(listener);
        };
      },
      [id],
    ),
    () => {
      const watched = id ? id.split("\n") : [];
      const seen = watched.map((key) => entries.get(key));
      const previous = last.current;
      if (previous.id === id && seen.every((found, index) => found === previous.seen[index]))
        return previous.value;
      const value: Record<string, CachedResourceRead<T>> = {};
      watched.forEach((key, index) => {
        value[key] = { data: seen[index]?.value as T | undefined, error: seen[index]?.error };
      });
      last.current = { id, seen, value };
      return value;
    },
  );

  const latestLoader = useLatest(loader);
  useEffect(() => {
    const watched = id ? id.split("\n") : [];
    for (const key of watched) {
      void restore(key, persist);
      if (loadNow) load(key, () => latestLoader.current(key), persist, true).catch(() => {});
    }
  }, [id, persist, loadNow, latestLoader]);

  return snapshot;
}

function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
