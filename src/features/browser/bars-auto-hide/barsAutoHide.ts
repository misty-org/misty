import { setBrowserWebviewsSuspended } from "@/features/app-windows";
import { useSidebarCollapsedStore } from "../../../app/shell/sidebarCollapsed";

/** Whether the tab sidebar is tucked away until the pointer reaches its window edge. */
export function useTabsAutoHide(): boolean {
  return useSidebarCollapsedStore((state) => state.collapsed);
}

/** Setup's choice: tucks the tab sidebar away, or keeps it open. */
export function setTabsAutoHide(on: boolean): void {
  const sidebar = useSidebarCollapsedStore.getState();
  if (sidebar.collapsed === on) return;
  // Native pages sit above the app, so they step aside while the drawer slides.
  setBrowserWebviewsSuspended(true, "sidebar-toggle");
  window.setTimeout(() => setBrowserWebviewsSuspended(false, "sidebar-toggle"), 340);
  sidebar.toggle();
}
