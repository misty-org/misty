import { create, type StoreApi, type UseBoundStore } from "zustand";
import { invoke } from "@/shared/platform/native_invoke";

export interface DeviceSetting<T> {
  value: T;
  loaded: boolean;
  load(): Promise<void>;
  set(next: T | ((current: T) => T)): void;
}

interface Stored {
  revision: number;
  state: unknown;
}

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

export function announceDeviceSetting(scope: string) {
  ensureChannel()?.postMessage({ scope });
}

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
  } catch {}
}

function parse(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function createDeviceSetting<T>(options: {
  scope: string;
  defaults: T;
  normalize?: (stored: unknown) => T;
  legacyKey?: string;
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
  let changes = 0;
  let saving = 0;
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
  queueMicrotask(() => void store.getState().load());
  return store;
}
