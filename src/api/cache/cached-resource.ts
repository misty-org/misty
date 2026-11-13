import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { readApiAccountId } from "@/api/client/session";
import { readApiCache, writeApiCache } from "./api-cache";

/**
 * Where a resource's last answer is kept between launches, besides this session's memory:
 * - `"device"`: this computer's own data (engines, their CLIs, MCP servers, skills, usage), under
 *   `~/.misty/cache`, kept across sign-outs since it isn't the account's.
 * - `"account"`: the signed-in account's data, under the same cache, cleared at sign-out.
 * - `false`: this session only. Use it for anything that carries a secret (a key, a token): those
 *   stay in the keychain and are never copied to the cache.
 */
export type CachePersistence = "device" | "account" | false;

/** The cache scope device data is kept under, apart from every account's. */
const DEVICE_SCOPE = "device";

interface Entry {
  value?: unknown;
  hasValue: boolean;
  fetchedAt?: number;
  error?: unknown;
  /** The load in flight, shared by every reader of the key. */
  running?: Promise<unknown>;
  /** Whether the saved copy has been looked for this session. */
  restored: boolean;
  /** Counts loads, so only the newest one's answer lands. */
  generation: number;
}

const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();

function entry(key: string): Entry {
  let found = entries.get(key);
  if (!found) {
    found = { hasValue: false, restored: false, generation: 0 };
    entries.set(key, found);
  }
  return found;
}

function changed(key: string) {
  // A new object per change, so `useSyncExternalStore` sees it.
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
  // A fresh answer that came first wins over the saved one.
  if (!hit || entry(key).hasValue) return;
  try {
    Object.assign(entry(key), {
      value: JSON.parse(hit.body),
      hasValue: true,
      fetchedAt: hit.fetchedAt,
    });
    changed(key);
  } catch {
    /* a copy that can't be read is a miss */
  }
}

/**
 * Starts a load, or joins the one in flight when `join` says so. Only the newest load's answer is
 * kept: one that started before a change made here (`setCachedResource`) or before a newer load
 * is dropped, so a re-read after a change never lands the answer from before it.
 */
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
  // Where the answer is saved is decided now: an account switched meanwhile doesn't get it.
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
      // A failed refresh keeps the last answer on screen; the error is there to show beside it.
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

/**
 * Replaces what a resource shows, such as after a change made here, without loading it again. A
 * load already in flight started before the change, so its answer is dropped.
 */
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

/**
 * The last answer for `key`: this session's, else the copy saved between launches when `persist`
 * says so. For code outside React that hands a cached copy on (an `onCached` callback).
 */
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

/** The last answer for `key` this session, if there is one, for reading outside React. */
export function peekCachedResource<T>(key: string): T | undefined {
  return entries.get(key)?.value as T | undefined;
}

/**
 * Loads `key` again for every reader showing it, keeping what they show until it answers. It starts
 * a new load, since it follows a change or a person asking to check again; `join` shares a load
 * already in flight instead, for reads that only want the current answer.
 */
export function refreshCachedResource<T>(
  key: string,
  loader: () => Promise<T>,
  persist: CachePersistence = false,
  options: { join?: boolean } = {},
): Promise<T> {
  return load(key, loader, persist, options.join ?? false);
}

/** Forgets everything this session holds (tests start from nothing); saved copies stay. */
export function clearCachedResources() {
  entries.clear();
  for (const set of listeners.values()) for (const listener of set) listener();
}

export interface CachedResource<T> {
  /** The last answer: the cached copy at first, then the fresh one. */
  data: T | undefined;
  /** When `data` was fetched (Unix milliseconds), if there is any. */
  fetchedAt: number | undefined;
  /** The last load's error. `data` stays as it was beside it. */
  error: unknown;
  /** Nothing to show yet and a load is under way: the only time to draw a skeleton. */
  loading: boolean;
  /** A load is under way behind what is shown. */
  refreshing: boolean;
  /**
   * Loads again, keeping what is shown until the answer arrives. It starts a new load even with
   * one in flight, since it follows a change or a person asking to check again.
   */
  reload: (options?: { force?: boolean }) => Promise<T | undefined>;
  /** Replaces what is shown, such as after a change made here. */
  set: (next: T | ((previous: T | undefined) => T)) => void;
}

/**
 * Data a screen shows, stale-while-revalidate: the last answer paints at once (from this session,
 * else from `~/.misty/cache` when `persist` says so), and a fresh load runs behind it each time the
 * screen opens. Every screen showing the same `key` shares one answer and one load in flight. A
 * skeleton belongs only where `loading` is true: the very first load, with nothing saved.
 *
 * `key` names the data and everything it depends on (`"engines/mcp:" + engine`); `null` holds off.
 * `loader` is read when a load starts, so it can close over the current props.
 */
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

  // The loader is read only when a load starts, so it always closes over the current props.
  const latestLoader = useLatest(loader);
  useEffect(() => {
    if (!key) return;
    void restore(key, persist);
    // Opening a screen joins a load another screen already started.
    load(key, () => latestLoader.current(), persist, true).catch(() => {
      /* kept on the entry, shown beside the data */
    });
  }, [key, persist, latestLoader]);

  // `force` is accepted for callers written against the joining reload; every reload is fresh.
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
    // Before the first effect runs there is no load yet, but one is about to start.
    loading: Boolean(key) && !hasValue && (running || !snapshot?.error),
    refreshing: running && hasValue,
    reload,
    set,
  };
}

/** The newest `value`, readable from effects and callbacks without restarting them. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
