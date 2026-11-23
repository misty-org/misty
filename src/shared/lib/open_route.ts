export const openRouteEvent = "misty:open-route";

export function requestOpenRoute(route: string): void {
  window.dispatchEvent(new CustomEvent(openRouteEvent, { detail: { route } }));
}
