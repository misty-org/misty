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
