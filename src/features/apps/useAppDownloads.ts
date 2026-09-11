import { useAppNavigationStore } from "./appNavigation";
import { persist } from "zustand/middleware";
import { create } from "zustand";
import type { OfficialApp } from "@/api/apps";
import { hasTauriInternals } from "@/shared/platform/tauri";
import {
  installOfficialDesktopPackage,
  officialDesktopPackageReady,
  uninstallOfficialDesktopPackage,
} from "./desktop-package-runtime";

export const appDownloadKey = (app: OfficialApp) =>
  `${app.id}:${app.version}:${app.desktop.sha256 ?? ""}`;
interface Downloads {
  ready: Record<string, boolean>;
  removed: Record<string, boolean>;
  remove: (app: OfficialApp) => Promise<void>;
  check: (apps: OfficialApp[]) => Promise<void>;
  get: (app: OfficialApp, automatic?: boolean) => Promise<void>;
}
export const useAppDownloads = create<Downloads>()(
  persist(
    (set, get) => {
      const removing = new Set<string>();
      const checking = new Map<string, Promise<void>>();
      const downloads = new Map<string, Promise<void>>();
      return {
        ready: {},
        removed: {},
        async remove(app) {
          if (!hasTauriInternals())
            throw new Error("Open Misty on desktop to remove downloaded apps.");
          if (removing.has(app.id)) throw new Error("This app is already being removed.");
          removing.add(app.id);
          try {
            set((state) => ({ removed: { ...state.removed, [app.id]: true } }));
            await Promise.all(
              [...downloads.entries()]
                .filter(([key]) => key.startsWith(`${app.id}:`))
                .map(([, request]) => request.catch(() => {})),
            );
            await Promise.all(
              [...checking.entries()]
                .filter(([key]) => key.startsWith(`${app.id}:`))
                .map(([, request]) => request),
            );
            await uninstallOfficialDesktopPackage(app.id);
            // SDK storage is namespaced by deployment/account/app/Space. Remove only this app.
            for (const key of Array.from({ length: localStorage.length }, (_, index) =>
              localStorage.key(index),
            )) {
              if (!key) continue;
              const legacyPrefixes =
                app.id === "planner"
                  ? [
                      "misty:agenda-visibility:",
                      "misty:roadmap-pins:",
                      "misty:roadmap-expanded-goals:",
                      "misty:roadmap-viewport:",
                    ]
                  : app.id === "journal"
                    ? ["misty:note-pins:", "misty:drawing-pins:"]
                    : [];
              if (legacyPrefixes.some((prefix) => key.startsWith(prefix)))
                localStorage.removeItem(key);
              const parts = key.split(":");
              if (
                key.startsWith("misty:app:v3:") &&
                parts[5] === encodeURIComponent(app.app_id ?? app.id)
              )
                localStorage.removeItem(key);
            }
            useAppNavigationStore.setState((state) => ({
              entries: state.entries.filter((entry) => entry.identity.appId !== app.id),
              providerCache: state.providerCache.filter((entry) => entry.identity.appId !== app.id),
            }));
            set((state) => ({
              ready: Object.fromEntries(
                Object.entries(state.ready).map(([key, value]) => [
                  key,
                  key.startsWith(`${app.id}:`) ? false : value,
                ]),
              ),
            }));
          } finally {
            removing.delete(app.id);
          }
        },
        async check(apps) {
          if (!hasTauriInternals()) return;
          await Promise.all(
            apps.map((app) => {
              const key = appDownloadKey(app);
              if (get().removed[app.id] || key in get().ready) return;
              if (checking.has(key)) return checking.get(key);
              const request = officialDesktopPackageReady(app)
                .then((ready) => {
                  set((state) => ({ ready: { ...state.ready, [key]: ready } }));
                })
                .catch(() => {
                  /* A failed probe is retried next time; it never grants access. */
                })
                .finally(() => checking.delete(key));
              checking.set(key, request);
              return request;
            }),
          );
        },
        async get(app, automatic = false) {
          if (removing.has(app.id) || (automatic && get().removed[app.id]))
            throw new Error("Get this app again in Discover before using it.");
          if (!hasTauriInternals()) throw new Error("Open Misty on desktop to download this app.");
          if (app.desktop.runtime !== "downloaded")
            throw new Error("This app has no downloadable desktop package.");
          const key = appDownloadKey(app);
          if (downloads.has(key)) return downloads.get(key);
          const request = (async () => {
            await checking.get(key);
            await installOfficialDesktopPackage(app);
            set((state) => ({
              ready: { ...state.ready, [key]: true },
              removed: { ...state.removed, [app.id]: removing.has(app.id) },
            }));
          })().finally(() => downloads.delete(key));
          downloads.set(key, request);
          return request;
        },
      };
    },
    { name: "misty-removed-apps", partialize: (state) => ({ removed: state.removed }) },
  ),
);
