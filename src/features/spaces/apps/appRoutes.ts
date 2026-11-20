/** Where an app opens in a Space: its frame, at `/spaces/<id>/app/<app>`. */
export function appRoute(spaceId: string, appId: string): string {
  return `/spaces/${encodeURIComponent(spaceId)}/app/${encodeURIComponent(appId)}`;
}
