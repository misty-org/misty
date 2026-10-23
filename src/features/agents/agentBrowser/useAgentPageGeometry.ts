import { useLayoutEffect, type RefObject } from "react";
import { visibleBrowserBounds } from "@/features/browser";
import {
  browserRuntimeResumeEvent,
  hideAdoptedBrowserPage,
  isBrowserLayoutMoving,
  requestBrowserWebviewLayoutByRuntimeId,
  showAdoptedBrowserPage,
} from "@/features/webviews/browserRuntime";
import { onBrowserSettled } from "@/features/webviews/browserSwitchHandoff";
import { appZoomChangedEvent } from "@/shared/hooks/useAppZoom";

/** An agent page's key in the browser runtime's presented state. */
export const agentPageKey = (viewId: string) => `agent-page:${viewId}`;

/**
 * Places an agent's live page over its host the way a tab's page is placed over its own
 * (useBrowserWebviewGeometry.ts): measured by the same code, shown through the runtime's
 * adopted pages (first-paint hold, parking and switching included), re-measured on the same
 * events, and taken off screen when the host leaves the screen. A dialog or menu opening over the app
 * moves every page beneath the renderer (browser_webviews_set_overlay_active), where the transparent
 * host shows it through, so nothing here hides it for one. Off screen the page keeps painting for
 * the agent.
 */
export function useAgentPageGeometry(hostRef: RefObject<HTMLDivElement | null>, viewId: string) {
  useLayoutEffect(() => {
    if (!viewId) return;
    let disposed = false;
    let frame = 0;
    let shown = false;
    const synchronize = () => {
      frame = 0;
      // While the chrome moves to a new edge the page holds still; the move's end re-measures.
      if (disposed || isBrowserLayoutMoving()) return;
      const host = hostRef.current;
      const bounds = host ? visibleBrowserBounds(host) : null;
      if (!bounds) {
        if (shown) void hideAdoptedBrowserPage(viewId);
        shown = false;
        return;
      }
      shown = true;
      void showAdoptedBrowserPage(viewId, agentPageKey(viewId), bounds).catch(() => undefined);
    };
    const schedule = () => {
      if (!disposed && !frame) frame = window.requestAnimationFrame(synchronize);
    };
    const host = hostRef.current;
    const resize = new ResizeObserver(schedule);
    if (host) resize.observe(host);
    // Only an enclosing scroller can move the host; the chat scrolling beside it cannot.
    const scrolled = (event: Event) => {
      if (
        !hostRef.current ||
        (event.target instanceof Node && event.target.contains(hostRef.current))
      )
        schedule();
    };
    // A dialog opening over the app marks the rest of it hidden.
    const dialogs = new MutationObserver(schedule);
    dialogs.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-hidden", "inert"],
    });
    const recover = () => requestBrowserWebviewLayoutByRuntimeId(viewId);
    const stopSettled = onBrowserSettled(schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", scrolled, true);
    window.addEventListener(browserRuntimeResumeEvent, schedule);
    window.addEventListener(appZoomChangedEvent, schedule);
    window.addEventListener("misty:workspace-geometry-changed", recover);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    document.addEventListener("visibilitychange", schedule);
    schedule();
    // The chat's layout settles over a few frames after a switch.
    const timers = [50, 200, 600].map((delay) => window.setTimeout(schedule, delay));
    return () => {
      disposed = true;
      if (frame) window.cancelAnimationFrame(frame);
      timers.forEach((timer) => window.clearTimeout(timer));
      resize.disconnect();
      dialogs.disconnect();
      stopSettled();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", scrolled, true);
      window.removeEventListener(browserRuntimeResumeEvent, schedule);
      window.removeEventListener(appZoomChangedEvent, schedule);
      window.removeEventListener("misty:workspace-geometry-changed", recover);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      document.removeEventListener("visibilitychange", schedule);
      // Switching tabs keeps this page up until the next is presented, as the browser's own tabs do;
      // closing the whole agent browser removes the host, and then nothing takes its place.
      queueMicrotask(() => void hideAdoptedBrowserPage(viewId, host?.isConnected ? 120 : 0));
    };
  }, [hostRef, viewId]);
}
