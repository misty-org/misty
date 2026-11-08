import { useWorkspaceStore } from "@/features/app-windows";

/** Opens a store page in a new browser tab, leaving Settings if it is open. */
export function openStorePage(url: string) {
  window.dispatchEvent(new CustomEvent("misty:close-settings"));
  useWorkspaceStore.getState().openBrowserView({ url });
}
