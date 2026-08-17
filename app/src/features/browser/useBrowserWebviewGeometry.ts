import { appZoomChangedEvent, getAppliedAppZoom } from "@/shared/hooks/useAppZoom";
import type { RefObject } from "react";
import { useEffect, useRef } from "react";
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
  tab: WorkspaceTab;
  url: string;
  theme: BrowserTheme;
}

export function useBrowserWebviewGeometry(input: BrowserGeometryInput): void {
  const latest = useRef(input);
  latest.current = input;
  const tabId = input.tab.id;
  const tabInstanceKey = input.tab.instanceKey;

  useEffect(() => {
    if (!input.nativeRuntime) return;
    let disposed = false;
    let frame = 0;
    const recoveryTimers: number[] = [];
    let hiddenForInvalidBounds = false;
    let geometryError: string | null = null;
    const host = input.hostRef.current;
    const effectTab = { id: tabId, instanceKey: tabInstanceKey };

    const synchronize = () => {
      frame = 0;
      if (disposed) return;
      const current = latest.current;
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
    const observer = new ResizeObserver(schedule);
    if (host) observer.observe(host);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener(browserRuntimeResumeEvent, schedule);
    window.addEventListener(appZoomChangedEvent, schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    document.addEventListener("visibilitychange", schedule);
    schedule();
    // Native child visibility can finish changing just after a React layout
    // transition. These bounded retries repair that race without returning to
    // continuous animation-frame polling.
    const recoverLayout = () => requestBrowserWebviewLayout(effectTab);
    recoveryTimers.push(window.setTimeout(recoverLayout, 150));
    recoveryTimers.push(window.setTimeout(recoverLayout, 750));

    return () => {
      disposed = true;
      if (frame) window.cancelAnimationFrame(frame);
      recoveryTimers.forEach((timer) => window.clearTimeout(timer));
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener(browserRuntimeResumeEvent, schedule);
      window.removeEventListener(appZoomChangedEvent, schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      document.removeEventListener("visibilitychange", schedule);
      void hideBrowserWebview(effectTab);
    };
  }, [input.hostRef, input.nativeRuntime, tabId, tabInstanceKey]);
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
