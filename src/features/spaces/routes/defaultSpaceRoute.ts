/** The section a Space opens on: its home. */
export function defaultSpaceRoute(spaceId: string): string {
  return `/spaces/${encodeURIComponent(spaceId)}/home`;
}
