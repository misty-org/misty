import { useLayoutEffect, type RefObject } from "react";
import { dockingMetrics } from "./dockingGeometry";

/** Native controls only exclude the part of a toolbar they actually overlap. */
export function windowChromeInsets(
  bounds: { left: number; right: number; top: number; bottom: number },
  width: number,
  left: number,
  right: number,
) {
  const touchesTitlebar = bounds.top < dockingMetrics.titlebar && bounds.bottom > 0;
  return {
    touchesTitlebar,
    left: touchesTitlebar ? Math.max(0, left + 8 - bounds.left) : 0,
    right: touchesTitlebar && right > 0 ? Math.max(0, bounds.right - (width - right - 8)) : 0,
  };
}

/** Merge existing page chrome into the native titlebar, including split panes.
 * Only top-edge toolbars receive insets; lower panes keep their normal spacing. */
export function useMergedTitlebar(
  ref: RefObject<HTMLElement | null>,
  layoutKey: string,
  enabled: boolean,
  chromeLeft: number,
  chromeRight: number,
) {
  useLayoutEffect(() => {
    const shell = ref.current;
    if (!shell || !enabled) return;
    let frame = 0;
    const modified = new Map<HTMLElement, { drag: string | null }>();
    const basePadding = new WeakMap<HTMLElement, { left: string; right: string }>();
    const clear = (element: HTMLElement) => {
      const original = modified.get(element);
      element.removeAttribute("data-window-chrome");
      element.removeAttribute("data-window-titlebar-fallback-active");
      for (const property of ["left", "right", "top"])
        element.style.removeProperty(`--window-chrome-${property}`);
      element.style.removeProperty("--window-toolbar-base-left");
      element.style.removeProperty("--window-toolbar-base-right");
      if (original?.drag == null) element.removeAttribute("data-misty-window-titlebar-region");
      else element.setAttribute("data-misty-window-titlebar-region", original.drag);
      modified.delete(element);
    };
    const measure = () => {
      frame = 0;
      const shellBounds = shell.getBoundingClientRect();
      const scale = shell.offsetWidth ? shellBounds.width / shell.offsetWidth : 1;
      if (!scale) return;
      const bounds = (element: HTMLElement) => {
        const r = element.getBoundingClientRect();
        return {
          left: (r.left - shellBounds.left) / scale,
          right: (r.right - shellBounds.left) / scale,
          top: (r.top - shellBounds.top) / scale,
          bottom: (r.bottom - shellBounds.top) / scale,
        };
      };
      // Measure the content's natural top edge so a newly mounted toolbar can
      // replace the fallback header rather than remaining below its padding.
      for (const element of modified.keys())
        element.removeAttribute("data-window-titlebar-fallback-active");
      const retained = new Set<HTMLElement>();
      const apply = (element: HTMLElement, fallback = false, sideTabs = false) => {
        const rect = bounds(element);
        if (
          rect.right <= rect.left ||
          rect.bottom <= rect.top ||
          element.closest('[inert], [aria-hidden="true"]')
        )
          return;
        const insets = windowChromeInsets(rect, shellBounds.width / scale, chromeLeft, chromeRight);
        if (!insets.touchesTitlebar) return;
        retained.add(element);
        if (!modified.has(element)) {
          modified.set(element, {
            drag: element.getAttribute("data-misty-window-titlebar-region"),
          });
          const style = getComputedStyle(element);
          basePadding.set(element, { left: style.paddingLeft, right: style.paddingRight });
        }
        element.dataset.windowChrome = "true";
        const padding = basePadding.get(element)!;
        element.style.setProperty("--window-toolbar-base-left", padding.left);
        element.style.setProperty("--window-toolbar-base-right", padding.right);
        element.style.setProperty("--window-chrome-left", `${insets.left}px`);
        element.style.setProperty("--window-chrome-right", `${insets.right}px`);
        if (sideTabs)
          element.style.setProperty(
            "--window-chrome-top",
            insets.left || insets.right ? `${dockingMetrics.titlebar}px` : "0px",
          );
        else if (fallback) element.dataset.windowTitlebarFallbackActive = "true";
        else element.dataset.mistyWindowTitlebarRegion = "true";
      };
      shell
        .querySelectorAll<HTMLElement>(
          '[data-window-toolbar], .misty-global-navigator[data-dock-position="top"]',
        )
        .forEach((element) => apply(element));
      shell
        .querySelectorAll<HTMLElement>(
          '.misty-workspace-tabs:is([data-tab-position="left"], [data-tab-position="right"])',
        )
        .forEach((element) => apply(element, false, true));
      // A top tab strip already owns the titlebar band; panes start below it (overlapping
      // only by the connected-tab seam) and never need the fallback title header.
      const topTabs = shell.querySelector('.misty-workspace-tabs[data-tab-position="top"]');
      if (!topTabs)
        shell.querySelectorAll<HTMLElement>("[data-workspace-pane]").forEach((pane) => {
          if (![...retained].some((element) => pane.contains(element))) apply(pane, true);
        });
      for (const element of modified.keys()) if (!retained.has(element)) clear(element);
      if (
        shell
          .getAnimations?.({ subtree: true })
          .some(
            (animation) =>
              animation.playState === "running" &&
              animation.effect?.getComputedTiming().iterations !== Infinity,
          )
      )
        schedule();
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const resize = new ResizeObserver(schedule);
    const observe = () => {
      resize.disconnect();
      resize.observe(shell);
      shell
        .querySelectorAll(
          "[data-window-toolbar], [data-workspace-pane], .misty-global-navigator, .misty-workspace-tabs",
        )
        .forEach((element) => resize.observe(element));
    };
    const mutations = new MutationObserver((records) => {
      if (records.some((record) => record.type === "childList")) observe();
      schedule();
    });
    mutations.observe(shell, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "aria-hidden", "inert"],
    });
    shell.addEventListener("transitionrun", schedule);
    window.addEventListener("resize", schedule);
    observe();
    measure();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      shell.removeEventListener("transitionrun", schedule);
      window.removeEventListener("resize", schedule);
      for (const element of modified.keys()) clear(element);
    };
  }, [ref, layoutKey, enabled, chromeLeft, chromeRight]);
}
