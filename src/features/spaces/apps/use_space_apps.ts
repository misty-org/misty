import { useCallback, useEffect, useSyncExternalStore } from "react";
import { SpaceRequestError } from "../api/api";
import { spaceAppsApi } from "./server_apps";
import type { InstalledSpaceApp } from "./server_apps";

interface Entry {
  apps: InstalledSpaceApp[] | null;
  error: string;
  loading: boolean;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const stale = new Set<string>();
const inFlight = new Set<string>();
const localWrites = new Map<string, number>();
const empty: Entry = { apps: null, error: "", loading: false };

const read = (spaceId: string): Entry => entries.get(spaceId) ?? empty;
const write = (spaceId: string, entry: Entry) => {
  entries.set(spaceId, entry);
  for (const listener of [...listeners]) listener();
};
const writeLocally = (spaceId: string, entry: Entry) => {
  localWrites.set(spaceId, (localWrites.get(spaceId) ?? 0) + 1);
  write(spaceId, entry);
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

async function load(spaceId: string, changed = false): Promise<void> {
  const before = read(spaceId);
  if (inFlight.has(spaceId)) {
    if (changed) stale.add(spaceId);
    return;
  }
  inFlight.add(spaceId);
  stale.delete(spaceId);
  const writes = localWrites.get(spaceId) ?? 0;
  try {
    if (before.apps === null || before.error)
      write(spaceId, { ...before, loading: before.apps === null, error: "" });
    const next = await spaceAppsApi.list(spaceId);
    const current = read(spaceId);
    const same = current.apps !== null && JSON.stringify(current.apps) === JSON.stringify(next);
    if ((localWrites.get(spaceId) ?? 0) !== writes) stale.add(spaceId);
    else if (!same || current.error || current.loading)
      write(spaceId, { apps: same ? current.apps : next, error: "", loading: false });
  } catch (reason) {
    const absent = reason instanceof SpaceRequestError && reason.status === 404;
    if ((localWrites.get(spaceId) ?? 0) !== writes) stale.add(spaceId);
    else
      write(spaceId, {
        apps: absent ? [] : read(spaceId).apps,
        error: absent
          ? ""
          : reason instanceof Error
            ? reason.message
            : "The apps couldn't be loaded.",
        loading: false,
      });
  } finally {
    inFlight.delete(spaceId);
  }
  if (stale.delete(spaceId)) await load(spaceId, true);
}

const changedSpace = (event: Event) => {
  const detail = (event as CustomEvent<{ spaceId?: unknown } | undefined>).detail;
  const spaceId = typeof detail?.spaceId === "string" ? detail.spaceId : "";
  const known = spaceId ? [spaceId].filter((id) => entries.has(id)) : [...entries.keys()];
  for (const id of known) void load(id, true);
};

if (typeof window !== "undefined")
  window.addEventListener("misty:space-apps-changed", changedSpace);

export function useSpaceApps(spaceId: string) {
  const entry = useSyncExternalStore(
    subscribe,
    () => read(spaceId),
    () => empty,
  );
  useEffect(() => {
    if (spaceId && read(spaceId).apps === null) void load(spaceId);
  }, [spaceId]);

  const reload = useCallback(() => void load(spaceId, true), [spaceId]);
  const install = useCallback(
    async (appId: string, version: string, permissions: string[]) => {
      const saved = await spaceAppsApi.install(spaceId, appId, version, permissions);
      const now = read(spaceId);
      writeLocally(spaceId, {
        ...now,
        apps: [...(now.apps ?? []).filter((app) => app.app_id !== appId), saved],
      });
    },
    [spaceId],
  );
  const remove = useCallback(
    async (appId: string) => {
      await spaceAppsApi.remove(spaceId, appId);
      const now = read(spaceId);
      writeLocally(spaceId, { ...now, apps: (now.apps ?? []).filter((app) => app.app_id !== appId) });
    },
    [spaceId],
  );
  return { apps: entry.apps, error: entry.error, reload, install, remove };
}
