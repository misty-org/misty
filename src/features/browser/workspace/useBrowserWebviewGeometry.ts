import { appZoomChangedEvent, getAppliedAppRenderScale } from "@/shared/hooks/useAppZoom";
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
import type { WorkspaceView } from "@/features/workspace";

interface BrowserGeometryInput {
  hostRef: RefObject<HTMLDivElement | null>;
  nativeRuntime: boolean;
  nativeLiveResize: boolean;
  tab: WorkspaceView;
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
      // Scroll/theme/recovery events can also schedule a frame during a drag.
      // Let AppKit keep sizing the visible child until the window settles.
      if (macNativeLiveResize && windowResizeActive) return;
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
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
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
    // Only an enclosing scroller can move or clip the host; scrolling other content
    // (or the page inside a pane) must not re-measure every mounted webview.
    const scrolled = (event: Event) => {
      const current = input.hostRef.current;
      if (!current || (event.target instanceof Node && event.target.contains(current))) schedule();
    };
    window.addEventListener("scroll", scrolled, true);
    window.addEventListener(browserRuntimeResumeEvent, schedule);
    window.addEventListener(appZoomChangedEvent, schedule);
    window.visualViewport?.addEventListener("resize", observeWindowResize);
    window.visualViewport?.addEventListener("scroll", schedule);
    document.addEventListener("visibilitychange", schedule);
    schedule();
    const recoverLayout = () => requestBrowserWebviewLayout(effectTab);
    window.addEventListener("misty:workspace-geometry-changed", recoverLayout);
    recoveryTimers.push(window.setTimeout(recoverLayout, 50));
    recoveryTimers.push(window.setTimeout(recoverLayout, 200));
    recoveryTimers.push(window.setTimeout(recoverLayout, 600));

    return () => {
      disposed = true;
      if (frame) window.cancelAnimationFrame(frame);
      if (settleTimer) window.clearTimeout(settleTimer);
      recoveryTimers.forEach((timer) => window.clearTimeout(timer));
      observer.disconnect();
      window.removeEventListener("misty:workspace-geometry-changed", recoverLayout);
      window.removeEventListener("resize", observeWindowResize);
      window.removeEventListener("scroll", scrolled, true);
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
  const cornerRadii = clippedCornerRadii(host, rect);
  return browserBoundsAtAppZoom(
    { x, y, width, height, ...(cornerRadii ? { cornerRadii } : {}) },
    getAppliedAppRenderScale(),
  );
}

/** The native page sits above the app, so CSS cannot round it. Report the
 * radius of each rounded corner the page reaches (its own device frame, the
 * workspace pane and the Misty panel edge) so the host can mask it. */
function clippedCornerRadii(
  host: HTMLElement,
  rect: DOMRect,
): BrowserBounds["cornerRadii"] | undefined {
  const radii: [number, number, number, number] = [0, 0, 0, 0];
  for (
    let clip: HTMLElement | null = host;
    clip;
    clip = clip.parentElement?.closest<HTMLElement>("[data-browser-corner-clip]") ?? null
  ) {
    const corners = clipCornerRadii(clip, rect);
    for (let index = 0; index < 4; index += 1)
      radii[index] = Math.max(radii[index]!, corners[index]!);
  }
  return radii.some((value) => value > 0) ? radii : undefined;
}

const cornerNames = ["top-left", "top-right", "bottom-right", "bottom-left"] as const;

function clipCornerRadii(clip: HTMLElement, rect: DOMRect): [number, number, number, number] {
  const style = getComputedStyle(clip);
  const box = clip.getBoundingClientRect();
  const pad = {
    top: parseFloat(style.paddingTop) || 0,
    right: parseFloat(style.paddingRight) || 0,
    bottom: parseFloat(style.paddingBottom) || 0,
    left: parseFloat(style.paddingLeft) || 0,
  };
  // The page fills the clip's padding box: a pane's seam is its padding.
  const edge = {
    top: box.top + pad.top,
    right: box.right - pad.right,
    bottom: box.bottom - pad.bottom,
    left: box.left + pad.left,
  };
  const meets = (a: number, b: number) => Math.abs(a - b) < 1;
  return cornerNames.map((name) => {
    const [y, x] = name.split("-") as ["top" | "bottom", "left" | "right"];
    if (!meets(rect[y], edge[y]) || !meets(rect[x], edge[x])) return 0;
    // Pane corners are masks drawn from the seam geometry, not border radii;
    // custom properties inherit, so only the pane itself reads them.
    const outer =
      clip.dataset.browserCornerClip === "seam"
        ? parseFloat(style.getPropertyValue(`--pane-corner-${name}`))
        : parseFloat(style.getPropertyValue(`border-${name}-radius`));
    return Math.max(0, (outer || 0) - Math.max(pad[y], pad[x]));
  }) as [number, number, number, number];
}

function isMacNativeRuntime(): boolean {
  return /Mac/.test(navigator.platform);
}

export function browserBoundsAtAppZoom(bounds: BrowserBounds, appZoom: number): BrowserBounds {
  const zoom = Number.isFinite(appZoom) && appZoom > 0 ? appZoom : 1;
  return quantizeBrowserBounds({
    x: bounds.x * zoom,
    y: bounds.y * zoom,
    width: bounds.width * zoom,
    height: bounds.height * zoom,
    ...(bounds.cornerRadii
      ? {
          cornerRadii: bounds.cornerRadii.map((radius) => radius * zoom) as [
            number,
            number,
            number,
            number,
          ],
        }
      : {}),
  });
}

export function quantizeBrowserBounds(bounds: BrowserBounds): BrowserBounds {
  const quantize = (value: number) => Math.round(value * 2) / 2;
  return {
    x: quantize(bounds.x),
    y: quantize(bounds.y),
    width: Math.max(1, quantize(bounds.width)),
    height: Math.max(1, quantize(bounds.height)),
    ...(bounds.cornerRadii ? { cornerRadii: bounds.cornerRadii } : {}),
  };
}
