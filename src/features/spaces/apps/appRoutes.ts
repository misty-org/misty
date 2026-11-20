import { officialApps, spaceMadeKinds } from "@misty/ui";

/** Built-in apps that run as bundles on misty-sdk, at `/spaces/<id>/app/<app>`; the rest are still host pages. */
const appsOnSdk: ReadonlySet<string> = new Set(["planner"]);

/**
 * Where a built-in app opens in a Space. An app that has moved onto the SDK opens in its frame; the others
 * are pages of the host until they move (`apps/<app>/`).
 */
export function officialAppRoute(spaceId: string, appId: string): string {
  const base = `/spaces/${encodeURIComponent(spaceId)}`;
  if (appsOnSdk.has(appId)) return `${base}/app/${encodeURIComponent(appId)}`;
  // Code isn't a page of the Space yet: it is the agents' Code view.
  if (appId === "code") return "/agents?view=code";
  const made = spaceMadeKinds.find((kind) => kind.place === appId);
  return `${base}/${made ? made.section : appId}`;
}

/** Where any app opens in a Space: Misty's own where they live, a third-party app in its frame. */
export function appRoute(spaceId: string, appId: string): string {
  return officialApps.some((app) => app.id === appId)
    ? officialAppRoute(spaceId, appId)
    : `/spaces/${encodeURIComponent(spaceId)}/app/${encodeURIComponent(appId)}`;
}

/** Whether a route (path and query, as a tab holds it) is this app's page in the Space. */
export function isAppRoute(route: string, spaceId: string, appId: string): boolean {
  const target = appRoute(spaceId, appId);
  if (appId === "code") return false;
  const [path] = route.split("?");
  const [targetPath] = target.split("?");
  return path === targetPath || path.startsWith(`${targetPath}/`);
}
