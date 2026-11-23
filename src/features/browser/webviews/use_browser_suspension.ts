import { useEffect } from "react";
import {
  browserBlockingOverlayOpen,
  browserNoticeRects,
  reconcileBrowserOverlayState,
  setBrowserNoticeRects,
  setBrowserPointerGestureActive,
  setBrowserWebviewsSuspended,
} from "@/features/app-windows";

export function useBrowserPointerSuspension(): void {
  useEffect(() => {
    const reorder = (event: Event) =>
      setBrowserWebviewsSuspended((event as CustomEvent<boolean>).detail, "pointer-reorder");
    window.addEventListener("misty:pointer-reorder", reorder);
    const beginPointerGesture = () => setBrowserPointerGestureActive(true);
    const endPointerGesture = () => setBrowserPointerGestureActive(false);
    const reconcilePointerGesture = (event: PointerEvent) => {
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

export function useBrowserOverlaySuspension(): void {
  useEffect(() => {
    const reason = "dom-overlay";
    let frame = 0;
    const synchronize = () => {
      frame = 0;
      setBrowserWebviewsSuspended(browserBlockingOverlayOpen(), reason);
      setBrowserNoticeRects(browserNoticeRects());
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(synchronize);
    };
    let blocking = false;
    const changed = () => {
      const open = browserBlockingOverlayOpen();
      if (open && !blocking) {
        blocking = true;
        setBrowserWebviewsSuspended(true, reason);
      } else if (!open) blocking = false;
      schedule();
    };
    const observer = new MutationObserver(changed);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["data-state"],
      childList: true,
      subtree: true,
    });
    window.addEventListener("resize", schedule);
    synchronize();
    reconcileBrowserOverlayState();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      setBrowserWebviewsSuspended(false, reason);
      setBrowserNoticeRects([]);
    };
  }, []);
}
