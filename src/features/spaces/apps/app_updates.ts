import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import {
  useRegistryApps,
  type AppSource,
  type CatalogApp,
  type ResolvedLink,
} from "./third_party_apps";
import { useSpaceApps } from "./use_space_apps";

interface AppUpdate {
  app: CatalogApp;
  from: string;
  source?: AppSource;
}

export function useAppUpdates(spaceId: string) {
  const { apps, error, reload, install } = useSpaceApps(spaceId);
  const listedApps = useRegistryApps();
  const [linked, setLinked] = useState<AppUpdate[]>([]);
  const unlisted = (apps ?? []).filter(
    (installed) =>
      installed.source &&
      !installed.source.listed &&
      !listedApps.some((entry) => entry.id === installed.app_id),
  );
  const unlistedKey = unlisted.map((app) => `${app.app_id}@${app.version}`).join(",");
  useEffect(() => {
    let live = true;
    void Promise.all(
      unlisted.map(async (installed): Promise<AppUpdate[]> => {
        try {
          const resolved = await invoke<ResolvedLink>("space_app_resolve", {
            link: installed.source!.repo,
          });
          return resolved.result === "app" &&
            resolved.entry.id === installed.app_id &&
            resolved.entry.version !== installed.version
            ? [{ app: resolved.entry, from: installed.version, source: resolved }]
            : [];
        } catch {
          return [];
        }
      }),
    ).then((found) => live && setLinked(found.flat()));
    return () => {
      live = false;
    };
    // The apps are read through `unlistedKey`, which changes when one is added, removed or updated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, unlistedKey]);
  const listed = (apps ?? []).flatMap((installed): AppUpdate[] => {
    const app = listedApps.find((entry) => entry.id === installed.app_id);
    return app && app.version !== installed.version ? [{ app, from: installed.version }] : [];
  });
  return { updates: [...listed, ...linked], loaded: Boolean(apps), error, reload, install };
}
