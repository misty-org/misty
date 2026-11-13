import { useCallback, useSyncExternalStore } from "react";
import type { StoreApi, UseBoundStore } from "zustand";
import { createDeviceSetting, type DeviceSetting } from "./deviceSetting";

type Entries<T> = Record<string, T>;

const own = <T>(entries: Entries<T>, key: string): T | undefined =>
  Object.prototype.hasOwnProperty.call(entries, key) ? entries[key] : undefined;

/**
 * A device setting with one entry per open-ended key (a Space, an account, a table), all kept in
 * one `misty.db` scope. Only the most recently changed entries stay, so it can't grow without end.
 * The store is made on first use, so nothing loads until something asks for an entry.
 */
export function createDeviceSettingMap<T>(options: {
  scope: string;
  /** Turns one stored entry into a valid value, or undefined to drop it. */
  normalize: (stored: unknown) => T | undefined;
  /** How many entries are kept; the ones changed longest ago go first. */
  limit?: number;
}) {
  const limit = options.limit ?? 200;
  let store: UseBoundStore<StoreApi<DeviceSetting<Entries<T>>>> | undefined;
  const setting = () =>
    (store ??= createDeviceSetting<Entries<T>>({
      scope: options.scope,
      defaults: {},
      normalize: (stored) => {
        const entries: Entries<T> = {};
        if (!stored || typeof stored !== "object" || Array.isArray(stored)) return entries;
        for (const [key, value] of Object.entries(stored)) {
          const entry = options.normalize(value);
          if (entry !== undefined) entries[key] = entry;
        }
        return entries;
      },
    }));

  const get = (key: string): T | undefined => own(setting().getState().value, key);

  /** Changes one entry (undefined removes it) and moves it to the newest end. */
  const set = (key: string, next: T | undefined | ((current: T | undefined) => T | undefined)) =>
    setting()
      .getState()
      .set((entries) => {
        const current = own(entries, key);
        const value =
          typeof next === "function"
            ? (next as (current: T | undefined) => T | undefined)(current)
            : next;
        const rest = Object.entries(entries).filter(([name]) => name !== key);
        if (value !== undefined) rest.push([key, value]);
        return Object.fromEntries(rest.slice(-limit));
      });

  /** One entry, kept current across windows; no key reads nothing and loads nothing. */
  function useEntry(key: string | undefined): T | undefined {
    const subscribe = useCallback(
      (listener: () => void) => (key === undefined ? () => {} : setting().subscribe(listener)),
      [key],
    );
    return useSyncExternalStore(subscribe, () => (key === undefined ? undefined : get(key)));
  }

  return { get, set, useEntry };
}
