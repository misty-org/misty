import { capturePageState } from "./native";
import { isExcludedSite, pageRestoreSettings } from "./settings";
import { liveBrowserTabs, pageReady, runtimeOf, tabUrl } from "./tabs";

let capturing = false;

/** Saves page state for every live synced tab. Only changed pages are
 * written unless `force` (before handing the workspace to another device). */
export async function captureAll(force = false): Promise<void> {
  if (!pageRestoreSettings().enabled || capturing) return;
  capturing = true;
  try {
    for (const tab of liveBrowserTabs().filter(pageReady).slice(0, 40)) {
      await capturePageState(runtimeOf(tab), tab.id, isExcludedSite(tabUrl(tab)), force).catch(
        () => false,
      );
    }
  } finally {
    capturing = false;
  }
}

/** Periodic capture while this device drives a workspace. */
export function startPageStateCapture(driving: () => boolean): () => void {
  const tick = () => {
    if (driving()) void captureAll(false);
  };
  const timer = window.setInterval(tick, 3000);
  const hidden = () => {
    if (document.visibilityState === "hidden" && driving()) void captureAll(true);
  };
  document.addEventListener("visibilitychange", hidden);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", hidden);
  };
}
