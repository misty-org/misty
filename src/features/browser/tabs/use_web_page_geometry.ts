import { useLayoutEffect, type RefObject } from "react";
import {
  browserRuntimeResumeEvent,
  isBrowserLayoutMoving,
  onBrowserSettled,
} from "@/features/app-windows";
import { appZoomChangedEvent } from "@/shared/hooks/use_app_zoom";
import { hideAdoptedBrowserPage, showAdoptedBrowserPage } from "../webviews/browser_adopted_pages";
import { visibleBrowserBounds } from "../webviews/browser_host_bounds";
import { requestBrowserWebviewLayoutByRuntimeId } from "../webviews/browser_runtime_sync";

export const webPageKey = (viewId: string) => `web-page:${viewId}`;

export function hostShown(host: HTMLElement): boolean {
  if (host.closest("[data-tab-kept], [hidden]")) return false;
  return (
    typeof host.checkVisibility !== "function" || host.checkVisibility({ visibilityProperty: true })
  );
}

export function useWebPageGeometry(hostRef: RefObject<HTMLDivElement | null>, viewId: string) {
  useLayoutEffect(() => {
    if (!viewId) return;
    let disposed = false;
    let frame = 0;
    let shown = false;
    const synchronize = () => {
      frame = 0;
      if (disposed || isBrowserLayoutMoving()) return;
      const host = hostRef.current;
      const bounds = host && hostShown(host) ? visibleBrowserBounds(host) : null;
      if (!bounds) {
        if (shown) void hideAdoptedBrowserPage(viewId);
        shown = false;
        return;
      }
      shown = true;
      void showAdoptedBrowserPage(viewId, webPageKey(viewId), bounds).catch(() => undefined);
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
    document.addEventListener("visibilitychange", schedule);
    schedule();
    return () => {
      disposed = true;
      if (frame) window.cancelAnimationFrame(frame);
      resize.disconnect();
      dialogs.disconnect();
      stopSettled();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", scrolled, true);
      window.removeEventListener(browserRuntimeResumeEvent, schedule);
      window.removeEventListener(appZoomChangedEvent, schedule);
      window.removeEventListener("misty:workspace-geometry-changed", recover);
      window.visualViewport?.removeEventListener("resize", schedule);
      document.removeEventListener("visibilitychange", schedule);
      queueMicrotask(() => void hideAdoptedBrowserPage(viewId));
    };
  }, [hostRef, viewId]);
}
