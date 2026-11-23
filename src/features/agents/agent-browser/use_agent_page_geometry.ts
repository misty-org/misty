import { useLayoutEffect, type RefObject } from "react";
import { visibleBrowserBounds } from "@/features/browser";
import { browserRuntimeResumeEvent, isBrowserLayoutMoving } from "@/features/app-windows";
import {
  hideAdoptedBrowserPage,
  requestBrowserWebviewLayoutByRuntimeId,
  showAdoptedBrowserPage,
} from "@/features/browser";
import { onBrowserSettled } from "@/features/app-windows";
import { appZoomChangedEvent } from "@/shared/hooks/use_app_zoom";

export const agentPageKey = (viewId: string) => `agent-page:${viewId}`;

export function agentPageHostShown(host: HTMLElement): boolean {
  if (host.closest("[data-tab-kept], [hidden]")) return false;
  return (
    typeof host.checkVisibility !== "function" || host.checkVisibility({ visibilityProperty: true })
  );
}

export function useAgentPageGeometry(
  hostRef: RefObject<HTMLDivElement | null>,
  viewId: string,
  options: {
    handoff?: boolean;
  } = {},
) {
  const handoff = options.handoff === true;
  useLayoutEffect(() => {
    if (!viewId) return;
    let disposed = false;
    let frame = 0;
    let shown = false;
    const synchronize = () => {
      frame = 0;
      if (disposed || isBrowserLayoutMoving()) return;
      const host = hostRef.current;
      const bounds = host && agentPageHostShown(host) ? visibleBrowserBounds(host) : null;
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
    const scrolled = (event: Event) => {
      if (
        !hostRef.current ||
        (event.target instanceof Node && event.target.contains(hostRef.current))
      )
        schedule();
    };
    const dialogs = new MutationObserver(schedule);
    dialogs.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-hidden", "inert", "hidden", "data-tab-kept"],
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
      queueMicrotask(() => {
        const switching = handoff && host?.isConnected === true && agentPageHostShown(host);
        void hideAdoptedBrowserPage(viewId, switching ? 120 : 0);
      });
    };
  }, [hostRef, viewId, handoff]);
}
