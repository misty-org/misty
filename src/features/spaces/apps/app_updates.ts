import { useRegistryApps, type CatalogApp } from "./third_party_apps";
import { useSpaceApps } from "./use_space_apps";

interface AppUpdate {
  app: CatalogApp;
  from: string;
}

export function useAppUpdates(spaceId: string) {
  const { apps, error, reload, install } = useSpaceApps(spaceId);
  const listedApps = useRegistryApps();
  const updates = (apps ?? []).flatMap((installed): AppUpdate[] => {
    const app = listedApps.find((entry) => entry.id === installed.app_id);
    return app && app.version !== installed.version ? [{ app, from: installed.version }] : [];
  });
  return { updates, loaded: Boolean(apps), error, reload, install };
}
