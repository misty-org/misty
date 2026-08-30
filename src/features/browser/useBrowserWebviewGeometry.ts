import { appZoomChangedEvent, getAppliedAppZoom } from "@/shared/hooks/useAppZoom";
import type { RefObject } from "react";
import { useLayoutEffect, useRef } from "react";
import {
  browserRuntimeResumeEvent,
  hideBrowserWebview,
  requestBrowserWebviewLayout,
  syncBrowserWebview,
  useBrowserRuntimeStore,
} from "./browserRuntime";
import type { BrowserBounds, BrowserTheme } from "./types";
import type { WorkspaceTab } from "@/features/workspace";

interface BrowserGeometryInput {
  hostRef: RefObject<HTMLDivElement | null>;
  nativeRuntime: boolean;
  nativeLiveResize: boolean;
  tab: WorkspaceTab;
  url: string;
  theme: BrowserTheme;
  offline?: boolean;
}

export function useBrowserWebviewGeometry(input: BrowserGeometryInput): void {
  const latest = useRef(input);
  latest.current = input;
  const tabId = input.tab.id;
  const tabInstanceKey = input.tab.instanceKey;

  useLayoutEffect(() => {
    if (!input.nativeRuntime) return;
    let disposed = false;
    let frame = 0;
    let settleTimer = 0;
    let windowSize = currentWindowSize();
    let windowResizeActive = false;
    const recoveryTimers: number[] = [];
    let hiddenForInvalidBounds = false;
    let geometryError: string | null = null;
    const host = input.hostRef.current;
    const effectTab = { id: tabId, instanceKey: tabInstanceKey };
    const macNativeLiveResize = input.nativeLiveResize && isMacNativeRuntime();

    const synchronize = () => {
      frame = 0;
      if (disposed) return;
      const current = latest.current;
      if (current.offline) {
        if (!hiddenForInvalidBounds) {
          hiddenForInvalidBounds = true;
          void hideBrowserWebview(current.tab);
        }
        return;
      }
      const bounds = current.hostRef.current ? visibleBrowserBounds(current.hostRef.current) : null;
      if (!bounds) {
        if (!hiddenForInvalidBounds) {
          hiddenForInvalidBounds = true;
          void hideBrowserWebview(current.tab);
        }
        return;
      }
      hiddenForInvalidBounds = false;
      void syncBrowserWebview({
        tab: current.tab,
        url: current.url,
        bounds,
        theme: current.theme,
        nativeLiveResize: current.nativeLiveResize,
      })
        .then(() => {
          if (
            geometryError &&
            useBrowserRuntimeStore.getState().errors[current.tab.id] === geometryError
          ) {
            useBrowserRuntimeStore.getState().setError(current.tab.id, null);
          }
          geometryError = null;
        })
        .catch((error: unknown) => {
          geometryError = error instanceof Error ? error.message : String(error);
          useBrowserRuntimeStore.getState().setError(current.tab.id, geometryError);
        });
    };

    const schedule = () => {
      if (disposed || frame) return;
      frame = window.requestAnimationFrame(synchronize);
    };
    const scheduleResizeSettle = () => {
      windowResizeActive = true;
      if (settleTimer) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        windowResizeActive = false;
        // AppKit keeps responsive children attached during live resize. One
        // final DOM measurement corrects split panes or shell offsets that did
        // not consume the entire window delta.
        requestBrowserWebviewLayout(effectTab);
      }, 120);
    };
    const observeHostResize = () => {
      const nextWindowSize = currentWindowSize();
      if (macNativeLiveResize && nextWindowSize !== windowSize) {
        windowSize = nextWindowSize;
        scheduleResizeSettle();
        return;
      }
      if (macNativeLiveResize && windowResizeActive) {
        scheduleResizeSettle();
        return;
      }
      schedule();
    };
    const observeWindowResize = () => {
      windowSize = currentWindowSize();
      if (macNativeLiveResize) scheduleResizeSettle();
      else schedule();
    };
    const observer = new ResizeObserver(observeHostResize);
    if (host) observer.observe(host);
    window.addEventListener("resize", observeWindowResize);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener(browserRuntimeResumeEvent, schedule);
    window.addEventListener(appZoomChangedEvent, schedule);
    window.visualViewport?.addEventListener("resize", observeWindowResize);
    window.visualViewport?.addEventListener("scroll", schedule);
    document.addEventListener("visibilitychange", schedule);
    schedule();
    const recoverLayout = () => requestBrowserWebviewLayout(effectTab);
    recoveryTimers.push(window.setTimeout(recoverLayout, 50));
    recoveryTimers.push(window.setTimeout(recoverLayout, 200));
    recoveryTimers.push(window.setTimeout(recoverLayout, 600));

    return () => {
      disposed = true;
      if (frame) window.cancelAnimationFrame(frame);
      if (settleTimer) window.clearTimeout(settleTimer);
      recoveryTimers.forEach((timer) => window.clearTimeout(timer));
      observer.disconnect();
      window.removeEventListener("resize", observeWindowResize);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener(browserRuntimeResumeEvent, schedule);
      window.removeEventListener(appZoomChangedEvent, schedule);
      window.visualViewport?.removeEventListener("resize", observeWindowResize);
      window.visualViewport?.removeEventListener("scroll", schedule);
      document.removeEventListener("visibilitychange", schedule);
      // The native page is a sibling of the React renderer, so unmounting the
      // Browser workspace does not remove it. Explicitly release this tab's
      // layer before the next active tab is presented.
      void hideBrowserWebview(effectTab);
    };
  }, [
    input.hostRef,
    input.nativeLiveResize,
    input.nativeRuntime,
    input.offline,
    tabId,
    tabInstanceKey,
  ]);
}

function currentWindowSize(): string {
  return `${window.innerWidth}:${window.innerHeight}`;
}

function visibleBrowserBounds(host: HTMLElement): BrowserBounds | null {
  if (!host.isConnected || document.visibilityState === "hidden") return null;
  const rect = host.getBoundingClientRect();
  const x = Math.max(0, rect.left);
  const y = Math.max(0, rect.top);
  const right = Math.min(window.innerWidth, rect.right);
  const bottom = Math.min(window.innerHeight, rect.bottom);
  const width = right - x;
  const height = bottom - y;
  if (width < 2 || height < 2) return null;
  return browserBoundsAtAppZoom({ x, y, width, height }, getAppliedAppZoom());
}

function isMacNativeRuntime(): boolean {
  return /Mac|iPhone|iPad/.test(navigator.platform);
}

export function browserBoundsAtAppZoom(bounds: BrowserBounds, appZoom: number): BrowserBounds {
  const zoom = Number.isFinite(appZoom) && appZoom > 0 ? appZoom : 1;
  return quantizeBrowserBounds({
    x: bounds.x * zoom,
    y: bounds.y * zoom,
    width: bounds.width * zoom,
    height: bounds.height * zoom,
  });
}

export function quantizeBrowserBounds(bounds: BrowserBounds): BrowserBounds {
  const quantize = (value: number) => Math.round(value * 2) / 2;
  return {
    x: quantize(bounds.x),
    y: quantize(bounds.y),
    width: Math.max(1, quantize(bounds.width)),
    height: Math.max(1, quantize(bounds.height)),
  };
}
