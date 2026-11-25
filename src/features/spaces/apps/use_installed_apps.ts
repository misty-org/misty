import { listen } from "@tauri-apps/api/event";
import { useEffect, useSyncExternalStore } from "react";
import { invoke } from "@/native";
import { hasTauriInternals } from "@/shared/platform/tauri";

export interface InstalledApp {
  app_id: string;
  version: string;
  permissions: string[];
  installed_at: number;
}

export interface AppBundleSource {
  url: string;
  sha256: string;
  wrap?: unknown;
}

interface Entry {
  apps: InstalledApp[] | null;
  error: string;
}

export interface AppServerProgress {
  received: number;
  total: number;
}

const listeners = new Set<() => void>();
let entry: Entry = { apps: null, error: "" };
let loading: Promise<void> | null = null;
let again = false;
let watching = false;
let downloads: Record<string, AppServerProgress> = {};
const installing = new Set<string>();

const setDownload = (appId: string, progress: AppServerProgress | null) => {
  const next = { ...downloads };
  if (progress) next[appId] = progress;
  else delete next[appId];
  downloads = next;
  for (const listener of [...listeners]) listener();
};

const write = (next: Entry) => {
  entry = next;
  for (const listener of [...listeners]) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

function load(): Promise<void> {
  if (loading) {
    again = true;
    return loading;
  }
  loading = (async () => {
    try {
      const apps = await invoke<InstalledApp[]>("apps_installed");
      if (JSON.stringify(apps) !== JSON.stringify(entry.apps) || entry.error)
        write({ apps, error: "" });
    } catch (reason) {
      write({
        apps: entry.apps,
        error: reason instanceof Error ? reason.message : String(reason || "The apps couldn't be loaded."),
      });
    } finally {
      loading = null;
    }
    if (again) {
      again = false;
      await load();
    }
  })();
  return loading;
}

function watch() {
  if (watching || !hasTauriInternals()) return;
  watching = true;
  void listen("misty://apps-changed", () => void load()).catch(() => {
    watching = false;
  });
  void listen<{ appId: string; received: number; total: number }>(
    "misty://app-server-install",
    ({ payload }) => {
      const done = payload.received >= payload.total;
      if (!done) setDownload(payload.appId, { received: payload.received, total: payload.total });
      else
        setDownload(
          payload.appId,
          installing.has(payload.appId) ? { received: payload.total, total: payload.total } : null,
        );
    },
  ).catch(() => undefined);
}

const downloadSnapshot = () => downloads;

export const installedApps = {
  reload: () => void load(),
  async install(appId: string, version: string, permissions: string[], source?: AppBundleSource) {
    installing.add(appId);
    if (!downloads[appId]) setDownload(appId, { received: 0, total: 0 });
    let saved: InstalledApp;
    try {
      saved = await invoke<InstalledApp>("apps_install", {
        appId,
        version,
        permissions,
        source: source ?? null,
      });
    } finally {
      installing.delete(appId);
      setDownload(appId, null);
    }
    write({
      apps: [...(entry.apps ?? []).filter((app) => app.app_id !== appId), saved],
      error: "",
    });
    return saved;
  },
  async remove(appId: string) {
    await invoke("apps_remove", { appId });
    write({ apps: (entry.apps ?? []).filter((app) => app.app_id !== appId), error: entry.error });
  },
};

export function useAppServerDownloads(): Record<string, AppServerProgress> {
  useEffect(() => watch(), []);
  return useSyncExternalStore(subscribe, downloadSnapshot, downloadSnapshot);
}

export function useInstalledApps() {
  const now = useSyncExternalStore(
    subscribe,
    () => entry,
    () => entry,
  );
  useEffect(() => {
    watch();
    if (entry.apps === null) void load();
  }, []);
  return {
    apps: now.apps,
    error: now.error,
    reload: installedApps.reload,
    install: installedApps.install,
    remove: installedApps.remove,
  };
}
