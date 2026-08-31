import { readDeploymentStorageItem } from "@/api/deployment/api";

const PANEL_VISIBLE_KEY = "misty:spaces-panel-visible";

export function readPanelVisible() {
  try {
    return window.localStorage.getItem(PANEL_VISIBLE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function writePanelVisible(visible: boolean) {
  try {
    window.localStorage.setItem(PANEL_VISIBLE_KEY, String(visible));
  } catch {
    /* storage can be unavailable in private contexts */
  }
}

export function readLastActiveSpaceId(userId?: string) {
  if (!userId) return "";
  try {
    return readDeploymentStorageItem(`misty:last-active-space:${userId}`) ?? "";
  } catch {
    return "";
  }
}

/**
 * Clears the pointer-events lock Radix leaves on <body> after a dialog closes.
 *
 * Closing a dialog programmatically (rather than through its own trigger) can
 * skip Radix's cleanup, leaving the whole page unclickable. Two passes cover
 * both the immediate close and the end of the exit animation.
 */
export function restoreDocumentInteractivityAfterModalClose(): void {
  if (typeof window === "undefined") return;
  const restore = () => {
    const modalOpen =
      document.querySelector("[data-slot='dialog-content'][data-state='open']") ||
      document.querySelector("[data-slot='alert-dialog-content'][data-state='open']");
    if (!modalOpen && document.body.style.pointerEvents === "none") {
      document.body.style.pointerEvents = "";
    }
  };
  window.setTimeout(restore, 0);
  window.setTimeout(restore, 250);
}
