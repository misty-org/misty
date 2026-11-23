export function defaultSpaceRoute(spaceId: string): string {
  return `/spaces/${encodeURIComponent(spaceId)}/home`;
}
