import { useSettingsStore } from "@/features/settings";
import { booleanSetting } from "@/features/settings/SettingsControls";
import { setBrowserWebviewsSuspended } from "@/features/webviews/browserRuntime";
import { useSidebarCollapsedStore } from "./sidebarCollapsed";

/** Whether the bars tuck away until the pointer reaches their window edge. */
export function useBarsAutoHide(): boolean {
  const document = useSettingsStore((state) => state.settings?.document);
  return booleanSetting(document ?? {}, "appearance", "space_bar_auto_hide", false);
}

/** Tucks the Space bar away or keeps it open. The tab sidebar has its own toggle. */
export function setSpaceBarAutoHide(on: boolean): void {
  useSettingsStore.getState().updateSetting("appearance", "space_bar_auto_hide", on);
}

/** Setup's one choice for both: tucks the tab sidebar and the Space bar away, or keeps both open. */
export function setBarsAutoHide(on: boolean): void {
  setSpaceBarAutoHide(on);
  const sidebar = useSidebarCollapsedStore.getState();
  if (sidebar.collapsed === on) return;
  // Native pages sit above the app, so they step aside while the drawer slides.
  setBrowserWebviewsSuspended(true, "sidebar-toggle");
  window.setTimeout(() => setBrowserWebviewsSuspended(false, "sidebar-toggle"), 340);
  sidebar.toggle();
}
