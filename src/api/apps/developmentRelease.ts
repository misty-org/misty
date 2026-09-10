import type { OfficialApp } from "./api";

function sameValues(left: string[] = [], right: string[] = []): boolean {
  const sorted = [...right].sort();
  return left.length === right.length && [...left].sort().every((value, index) => value === sorted[index]);
}

export function matchingDevelopmentApp(server: OfficialApp, local: OfficialApp): boolean {
  return server.id === local.id && server.official && local.official &&
    server.publisher === local.publisher && server.version === local.version &&
    server.permission_version === local.permission_version &&
    server.minimum_host_protocol === local.minimum_host_protocol &&
    server.minimum_host_version === local.minimum_host_version &&
    sameValues(server.requires_apps, local.requires_apps) &&
    sameValues(server.scopes, local.scopes) && sameValues(server.network_origins, local.network_origins);
}

/** Preserve the installed release's authority; only substitute a matching dev artifact. */
export function installedDevelopmentRelease(
  installed: OfficialApp,
  catalog: OfficialApp[],
  development = import.meta.env.DEV && !!import.meta.env.VITE_MISTY_APPS_DIRECTORY,
): OfficialApp {
  if (!development) return installed;
  const entry = `/__misty-local-apps/${encodeURIComponent(installed.id)}/desktop/app.js`;
  const local = catalog.find(app => app.desktop.entry === entry && matchingDevelopmentApp(installed, app));
  if (!local || installed.desktop.runtime !== "downloaded") return installed;
  return { ...installed, desktop: local.desktop };
}
