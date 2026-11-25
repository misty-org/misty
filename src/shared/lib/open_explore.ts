export const openExploreEvent = "misty:open-agents-page";

export function requestOpenExplore(tab: string, app?: string): void {
  window.dispatchEvent(
    new CustomEvent<{ tab: string; app?: string }>(openExploreEvent, {
      detail: app ? { tab, app } : { tab },
    }),
  );
}
