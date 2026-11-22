import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useRegistryApps, type AppSource, type CatalogApp, type ResolvedLink } from "./thirdPartyApps";
import { useSpaceApps } from "./useSpaceApps";

interface AppUpdate {
  app: CatalogApp;
  from: string;
  /** For an app added by its link: the newer pin, which goes with the update. */
  source?: AppSource;
}

/**
 * The Space's apps at an older version than the one now pinned. A listed app moves when Misty's catalog does
 * (`misty-apps` re-checks each release). An app added by its link is resolved again here: its latest release is
 * offered only when its manifest still checks out against it, and a link that no longer resolves offers nothing.
 */
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
