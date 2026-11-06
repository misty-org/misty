import { awaitingRestore } from "./afterReload";
import { capturePageState } from "./native";
import { isExcludedSite } from "./settings";
import { liveBrowserViews, pageReady, runtimeOf, viewUrl } from "./tabs";

let capturing = false;

/** Saves page state for this window's live tabs. Only changed pages are written unless
 * `force` (when the window is hidden). */
async function captureAll(force = false): Promise<void> {
  if (capturing) return;
  capturing = true;
  try {
    for (const tab of liveBrowserViews()
      .filter((tab) => pageReady(tab) && !awaitingRestore(tab.id))
      .slice(0, 40)) {
      await capturePageState(runtimeOf(tab), tab.id, isExcludedSite(viewUrl(tab)), force).catch(
        () => false,
      );
    }
  } finally {
    capturing = false;
  }
}

/** Periodic capture, and once more when the window is hidden. */
export function startPageStateCapture(): () => void {
  const timer = window.setInterval(() => void captureAll(false), 3000);
  const hidden = () => {
    if (document.visibilityState === "hidden") void captureAll(true);
  };
  document.addEventListener("visibilitychange", hidden);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", hidden);
  };
}
