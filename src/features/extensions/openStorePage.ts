import { useWorkspaceStore } from "@/features/workspace";

/** Opens a store page in a new browser tab, leaving Settings if it is open. */
export function openStorePage(url: string) {
  window.dispatchEvent(new CustomEvent("misty:close-settings"));
  useWorkspaceStore.getState().openBrowserView({ url, private: false });
}
