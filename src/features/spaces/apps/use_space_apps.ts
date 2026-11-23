import { useCallback, useEffect, useSyncExternalStore } from "react";
import { SpaceRequestError } from "../api/api";
import { spaceAppsApi } from "./server_apps";
import type { InstalledSpaceApp } from "./server_apps";
import type { AppSource } from "./third_party_apps";

interface Entry {
  apps: InstalledSpaceApp[] | null;
  error: string;
  loading: boolean;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const empty: Entry = { apps: null, error: "", loading: false };

const read = (spaceId: string): Entry => entries.get(spaceId) ?? empty;
const write = (spaceId: string, entry: Entry) => {
  entries.set(spaceId, entry);
  for (const listener of [...listeners]) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

async function load(spaceId: string): Promise<void> {
  const before = read(spaceId);
  if (before.loading) return;
  write(spaceId, { ...before, loading: true, error: "" });
  try {
    write(spaceId, { apps: await spaceAppsApi.list(spaceId), error: "", loading: false });
  } catch (reason) {
    const absent = reason instanceof SpaceRequestError && reason.status === 404;
    write(spaceId, {
      apps: absent ? [] : read(spaceId).apps,
      error: absent
        ? ""
        : reason instanceof Error
          ? reason.message
          : "The apps couldn't be loaded.",
      loading: false,
    });
  }
}

export function useSpaceApps(spaceId: string) {
  const entry = useSyncExternalStore(
    subscribe,
    () => read(spaceId),
    () => empty,
  );
  useEffect(() => {
    if (spaceId && read(spaceId).apps === null) void load(spaceId);
  }, [spaceId]);

  const reload = useCallback(() => void load(spaceId), [spaceId]);
  const install = useCallback(
    async (appId: string, version: string, permissions: string[], source?: AppSource) => {
      const saved = await spaceAppsApi.install(spaceId, appId, version, permissions, source);
      const now = read(spaceId);
      write(spaceId, {
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
      write(spaceId, { ...now, apps: (now.apps ?? []).filter((app) => app.app_id !== appId) });
    },
    [spaceId],
  );
  return { apps: entry.apps, error: entry.error, reload, install, remove };
}
