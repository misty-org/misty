import { useNavigate } from "react-router-dom";
import { permissionLines } from "./app_permissions";
import { appRoute } from "./app_routes";
import { catalogSource, isSiteApp, registryApps, siteHost, useRegistryApps } from "./third_party_apps";
import { useAppServerDownloads, useInstalledApps } from "./use_installed_apps";

export function useExploreInstalledApps(spaceId: string) {
  const navigate = useNavigate();
  const { apps, error, reload, install, remove } = useInstalledApps();
  const listed = useRegistryApps();
  const downloads = useAppServerDownloads();
  const here = new Map((apps ?? []).map((app) => [app.app_id, app] as const));
  return {
    listed,
    loaded: apps !== null,
    error,
    reload,
    versionOf: (appId: string) => here.get(appId)?.version,
    approvedOf: (appId: string) => here.get(appId)?.permissions ?? [],
    downloadOf: (appId: string) => downloads[appId],
    install: (appId: string, version: string, permissions: string[]) => {
      const entry = registryApps().find((app) => app.id === appId);
      return install(
        appId,
        version,
        permissions,
        entry && !isSiteApp(entry) ? catalogSource(entry) : undefined,
      );
    },
    remove,
    open: (appId: string) => navigate(appRoute(spaceId, appId)),
    permissionLine: (permission: string) => permissionLines[permission] ?? permission,
    isSite: isSiteApp,
    siteHost,
  };
}
