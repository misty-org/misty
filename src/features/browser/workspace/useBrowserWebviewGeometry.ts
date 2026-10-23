import { isAuthPath } from "@/features/app-shell/routes";
import { appThemeChangedEvent } from "@/features/settings";
import { appZoomChangedEvent } from "@/shared/hooks/useAppZoom";
import type { RefObject } from "react";
import { useLayoutEffect, useRef } from "react";
import {
  browserRuntimeResumeEvent,
  hideBrowserWebview,
  isBrowserLayoutMoving,
  isBrowserRuntimeCreated,
  prewarmBrowserWebview,
  requestBrowserWebviewLayout,
  syncBrowserWebview,
  useBrowserRuntimeStore,
  windowChromeChangedEvent,
} from "@/features/webviews/browserRuntime";
import { browserSlideActive } from "@/features/webviews/browserSlide";
import { visibleBrowserBounds } from "./browserHostBounds";
import {
  browserSurfaceStillActive,
  browserTabReplaced,
  currentWindowSize,
  isMacNativeRuntime,
  queueBrowserPrewarm,
  shownPageBounds,
  viewActive,
} from "./browserWebviewPlacement";
import type { BrowserTheme } from "@/features/webviews/types";
import { useWorkspaceStore, type WorkspaceView } from "@/features/workspace";

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

    // A tab in the panel that has not been shown yet loads its page in the background, so
    // clicking it shows the page at once instead of loading it then.
    let prewarmQueued = false;
    const prewarm = () => {
      if (prewarmQueued || isAuthPath(window.location.pathname)) return;
      prewarmQueued = true;
      queueBrowserPrewarm(() => {
        const current = latest.current;
        if (disposed || current.offline || !current.url || isBrowserRuntimeCreated(effectTab))
          return;
        // Shown meanwhile: its own sync creates it.
        if (current.hostRef.current && visibleBrowserBounds(current.hostRef.current)) return;
        const bounds = shownPageBounds();
        if (!bounds) {
          prewarmQueued = false;
          return;
        }
        return prewarmBrowserWebview({
          tab: current.tab,
          url: current.url,
          bounds,
          theme: current.theme,
          nativeLiveResize: current.nativeLiveResize,
        });
      });
    };

    const synchronize = () => {
      frame = 0;
      if (disposed) return;
      // While the chrome slides to a new edge the page holds still, rather than chasing every
      // frame of the motion through native calls. The layout's end re-measures every page.
      if (isBrowserLayoutMoving()) return;
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
          // A tab hidden because another browser tab took its place keeps its page up until
          // that page is on screen; parking it at once left a frame with no page at all.
          void hideBrowserWebview(current.tab, browserTabReplaced(current.tab.id) ? 120 : 0);
        }
        prewarm();
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
      // While a panel above the page slides (the Space bar), the observer's measurement is
      // already current for this frame, so measuring now sends the page its new size a frame
      // sooner than waiting for the next one. Any other layout change keeps the next frame, so
      // closing or switching tabs settles before the page moves.
      if (browserSlideActive()) {
        if (disposed) return;
        if (frame) window.cancelAnimationFrame(frame);
        synchronize();
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
    // Switching to a tab or view without this page hides it in the same tick as the switch,
    // not a frame or two later when the host's size observer notices it is gone. On Windows
    // the page drops beneath the renderer, so the old page is all that could show meanwhile.
    // A browser tab taking its place keeps the handoff, which the observer runs.
    const unsubscribeLayout = useWorkspaceStore.subscribe((state, previous) => {
      if (disposed || hiddenForInvalidBounds || state.layout === previous.layout) return;
      if (!viewActive(previous.layout.root, tabId) || viewActive(state.layout.root, tabId)) return;
      if (browserTabReplaced(tabId)) return;
      hiddenForInvalidBounds = true;
      void hideBrowserWebview(latest.current.tab);
    });
    window.addEventListener(browserRuntimeResumeEvent, schedule);
    window.addEventListener(appZoomChangedEvent, schedule);
    // The chrome around rounded corners changes color with the theme and the Space.
    window.addEventListener(appThemeChangedEvent, schedule);
    window.addEventListener(windowChromeChangedEvent, schedule);
    window.visualViewport?.addEventListener("resize", observeWindowResize);
    window.visualViewport?.addEventListener("scroll", schedule);
    document.addEventListener("visibilitychange", schedule);
    schedule();
    const recoverLayout = () => requestBrowserWebviewLayout(effectTab);
    window.addEventListener("misty:workspace-geometry-changed", recoverLayout);
    // A page that already exists only needs re-measuring while the layout
    // settles; forcing a native reconcile each time re-clips and re-stacks it,
    // which blinks right after a tab switch.
    const settleLayout = isBrowserRuntimeCreated(effectTab) ? schedule : recoverLayout;
    recoveryTimers.push(window.setTimeout(settleLayout, 50));
    recoveryTimers.push(window.setTimeout(settleLayout, 200));
    recoveryTimers.push(window.setTimeout(settleLayout, 600));

    return () => {
      disposed = true;
      if (frame) window.cancelAnimationFrame(frame);
      if (settleTimer) window.clearTimeout(settleTimer);
      recoveryTimers.forEach((timer) => window.clearTimeout(timer));
      observer.disconnect();
      unsubscribeLayout();
      window.removeEventListener("misty:workspace-geometry-changed", recoverLayout);
      window.removeEventListener("resize", observeWindowResize);
      window.removeEventListener("scroll", scrolled, true);
      window.removeEventListener(browserRuntimeResumeEvent, schedule);
      window.removeEventListener(appZoomChangedEvent, schedule);
      window.removeEventListener(appThemeChangedEvent, schedule);
      window.removeEventListener(windowChromeChangedEvent, schedule);
      window.visualViewport?.removeEventListener("resize", observeWindowResize);
      window.visualViewport?.removeEventListener("scroll", schedule);
      document.removeEventListener("visibilitychange", schedule);
      // The native page is a sibling of the React renderer, so unmounting the
      // Browser workspace does not remove it. Explicitly release this tab's
      // layer before the next active tab is presented.
      // Another browser tab taking this one's place presents itself within a
      // frame or two; keep this page up until then instead of flashing empty.
      void hideBrowserWebview(effectTab, browserSurfaceStillActive() ? 120 : 0);
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
