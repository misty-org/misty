import { create, type StoreApi, type UseBoundStore } from "zustand";
import { invoke } from "@/shared/platform/nativeInvoke";

/**
 * A choice a person makes about this device's interface (a width, a view, an order), kept in
 * `misty.db` (`settings_state`, under `scope`) like every other device setting, never synced.
 *
 * - It loads by itself as soon as the store is made, and every window hears another's change
 *   and reloads, so windows never drift apart or undo each other.
 * - A change is applied onto what is stored at the moment it commits (a revision check retries
 *   when another window wrote first), so an updater function never works from a stale copy.
 * - A copy in this webview's storage paints the first frame before the database answers, and
 *   carries the value where there is no database (a web preview). It is a cache, never the record.
 * - `legacyKey` names the webview storage key the choice used to live under: its value moves into
 *   `misty.db` on the first load that finds nothing stored, then the key is removed.
 */
export interface DeviceSetting<T> {
  value: T;
  /** True once `misty.db` has answered (or failed to), so first-run defaults can be told apart. */
  loaded: boolean;
  load(): Promise<void>;
  set(next: T | ((current: T) => T)): void;
}

interface Stored {
  revision: number;
  state: unknown;
}

/**
 * `misty.db` keeps only JSON objects per scope, so every value (a width, a flag, a list) is
 * stored inside this wrapper. A document saved before the wrapper is read as the value itself.
 */
interface Wrapped {
  deviceSetting: 1;
  value: unknown;
}
const wrap = (value: unknown): Wrapped => ({ deviceSetting: 1, value });
const unwrap = (state: unknown): unknown =>
  state && typeof state === "object" && (state as Partial<Wrapped>).deviceSetting === 1
    ? (state as Wrapped).value
    : state;

const channelName = "misty:device-setting";
const listeners = new Map<string, () => void>();
let channel: BroadcastChannel | null = null;

/** One channel per window; another window's save reloads that setting here. */
function ensureChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (!channel) {
    channel = new BroadcastChannel(channelName);
    channel.onmessage = (event: MessageEvent<{ scope?: string }>) => {
      if (event.data?.scope) listeners.get(event.data.scope)?.();
    };
  }
  return channel;
}

/** Tells the other windows that `scope` changed in `misty.db`, so they read it again. */
export function announceDeviceSetting(scope: string) {
  ensureChannel()?.postMessage({ scope });
}

/** Runs `reload` here whenever another window announces `scope`. */
export function onDeviceSettingChange(scope: string, reload: () => void) {
  listeners.set(scope, reload);
  ensureChannel();
}

const announce = announceDeviceSetting;
const listen = onDeviceSettingChange;

function readWebStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeWebStorage(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage can be off (a private window); the database still has it.
  }
}

function parse(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    // A legacy key may hold a bare string, such as "grid".
    return raw;
  }
}

export function createDeviceSetting<T>(options: {
  scope: string;
  defaults: T;
  /** Turns whatever is stored (or nothing) into a valid value; defaults to the stored value as is. */
  normalize?: (stored: unknown) => T;
  /** The webview storage key this choice used to live under, moved into `misty.db` once. */
  legacyKey?: string;
  /** Where the choice lived before, read once when `misty.db` has none and no `legacyKey` does. */
  seed?: () => unknown;
}): UseBoundStore<StoreApi<DeviceSetting<T>>> {
  const { scope, defaults } = options;
  const normalize = (stored: unknown): T => {
    if (stored === undefined || stored === null) return defaults;
    try {
      return options.normalize ? options.normalize(stored) : (stored as T);
    } catch {
      return defaults;
    }
  };
  const cacheKey = `misty.device:${scope}`;
  const legacy = () =>
    (options.legacyKey ? parse(readWebStorage(options.legacyKey)) : undefined) ?? options.seed?.();
  const cached = parse(readWebStorage(cacheKey));
  // Changes made in this window, and how many are still saving: a read that raced one of them
  // must not put the older stored value back, and only the newest save's answer is shown.
  let changes = 0;
  let saving = 0;
  // A reload skipped because a save was running happens once the saves finish, so another
  // window's change that landed meanwhile still shows here.
  let reloadAfterSave = false;

  const store = create<DeviceSetting<T>>((set, get) => ({
    value: normalize(cached !== undefined ? cached : legacy()),
    loaded: false,
    async load() {
      const changesBefore = changes;
      try {
        const stored = await invoke<Stored>("settings_session_state", { scope });
        let value = unwrap(stored.state);
        const moved = stored.state === null ? legacy() : undefined;
        if (moved !== undefined) {
          value = normalize(moved);
          await invoke("settings_session_commit", {
            scope,
            revision: stored.revision,
            document: wrap(value),
          });
          if (options.legacyKey) writeWebStorage(options.legacyKey, null);
        }
        if (changes !== changesBefore || saving > 0) {
          // A change made while this read ran is newer; read again once its save is done.
          if (saving > 0) reloadAfterSave = true;
          set({ loaded: true });
          return;
        }
        const next = normalize(value);
        writeWebStorage(cacheKey, JSON.stringify(next));
        set({ value: next, loaded: true });
      } catch {
        set({ loaded: true });
      }
    },
    set(next) {
      const change = (current: T) =>
        typeof next === "function" ? (next as (current: T) => T)(current) : next;
      const shown = change(get().value);
      const mine = ++changes;
      saving += 1;
      writeWebStorage(cacheKey, JSON.stringify(shown));
      set({ value: shown });
      void commit(change)
        .then((saved) => {
          announce(scope);
          if (mine !== changes) return;
          writeWebStorage(cacheKey, JSON.stringify(saved));
          set({ value: saved });
        })
        .catch(() => {
          // The save failed: show what is really stored rather than a value that isn't.
          if (mine === changes) queueMicrotask(() => void get().load());
        })
        .finally(() => {
          saving -= 1;
          if (saving === 0 && reloadAfterSave) {
            reloadAfterSave = false;
            void get().load();
          }
        });
    },
  }));

  async function commit(change: (current: T) => T): Promise<T> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const stored = await invoke<Stored>("settings_session_state", { scope });
      const next = change(normalize(unwrap(stored.state)));
      try {
        await invoke("settings_session_commit", {
          scope,
          revision: stored.revision,
          document: wrap(next),
        });
        return next;
      } catch (error) {
        if (!String(error).includes("SETTINGS_REVISION_CONFLICT")) throw error;
      }
    }
    throw new Error("This changed in another window. Try again.");
  }

  listen(scope, () => void store.getState().load());
  // Loads once the module has finished evaluating, so the first frame shows the cached value.
  queueMicrotask(() => void store.getState().load());
  return store;
}
