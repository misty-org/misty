import { useEffect } from "react";
import { browserBlockingOverlayOpen } from "./browserBlockingOverlay";
import {
  reconcileBrowserOverlayState,
  setBrowserPointerGestureActive,
  setBrowserWebviewsSuspended,
} from "./browserRuntime";

/** Suspends native pages during pointer reorders and drags that cross native views. */
export function useBrowserPointerSuspension(): void {
  useEffect(() => {
    const reorder = (event: Event) =>
      setBrowserWebviewsSuspended((event as CustomEvent<boolean>).detail, "pointer-reorder");
    window.addEventListener("misty:pointer-reorder", reorder);
    const beginPointerGesture = () => setBrowserPointerGestureActive(true);
    const endPointerGesture = () => setBrowserPointerGestureActive(false);
    const reconcilePointerGesture = (event: PointerEvent) => {
      // A pointer-up can land in a different native view. A subsequent move
      // with no buttons held proves the old gesture has ended.
      if (event.buttons === 0) endPointerGesture();
    };
    window.addEventListener("pointerdown", beginPointerGesture, true);
    window.addEventListener("pointerup", endPointerGesture, true);
    window.addEventListener("pointercancel", endPointerGesture, true);
    window.addEventListener("blur", endPointerGesture);
    window.addEventListener("pointermove", reconcilePointerGesture, true);
    window.addEventListener("lostpointercapture", endPointerGesture, true);
    window.addEventListener("focus", reconcileBrowserOverlayState);
    return () => {
      window.removeEventListener("misty:pointer-reorder", reorder);
      setBrowserWebviewsSuspended(false, "pointer-reorder");
      window.removeEventListener("pointerdown", beginPointerGesture, true);
      window.removeEventListener("pointerup", endPointerGesture, true);
      window.removeEventListener("pointercancel", endPointerGesture, true);
      window.removeEventListener("blur", endPointerGesture);
      window.removeEventListener("pointermove", reconcilePointerGesture, true);
      window.removeEventListener("lostpointercapture", endPointerGesture, true);
      window.removeEventListener("focus", reconcileBrowserOverlayState);
      setBrowserPointerGestureActive(false);
    };
  }, []);
}

/** Suspends native pages while app overlays (menus, dialogs, popovers) are open. */
export function useBrowserOverlaySuspension(): void {
  useEffect(() => {
    const reason = "dom-overlay";
    // This observer is a fallback for app overlays outside Browser chrome.
    // Browser toolbar menus suspend synchronously in onOpenChange so their
    // first portal frame cannot race the native child WebView.
    let frame = 0;
    const synchronize = () => {
      frame = 0;
      setBrowserWebviewsSuspended(browserBlockingOverlayOpen(), reason);
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(synchronize);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["data-state"],
      childList: true,
      subtree: true,
    });
    synchronize();
    reconcileBrowserOverlayState();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      setBrowserWebviewsSuspended(false, reason);
    };
  }, []);
}
