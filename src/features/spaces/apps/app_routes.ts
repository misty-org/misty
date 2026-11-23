export function appRoute(spaceId: string, appId: string): string {
  return `/spaces/${encodeURIComponent(spaceId)}/app/${encodeURIComponent(appId)}`;
}
