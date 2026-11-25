import { useBrowserRuntimeStore, useWorkspaceStore } from "@/features/app-windows";
import { visibleBrowserBounds } from "../webviews/browser_host_bounds";
import { hostShown } from "./use_web_page_geometry";

export type PageBox = { x: number; y: number; width: number; height: number };

export const shownPageBox = (host?: HTMLElement | null): PageBox | null => {
  const bounds = host && hostShown(host) ? visibleBrowserBounds(host) : null;
  return bounds && { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
};

export function shownPageSize(): PageBox {
  for (const selector of ["[data-browser-page-host]", "[data-workspace-pane]"])
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      const shown = shownPageBox(element);
      if (shown) return shown;
    }
  return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
}

function frontPageShown(): Promise<void> {
  const ready = () =>
    Object.values(useBrowserRuntimeStore.getState().presented).some(Boolean) ||
    !Array.from(document.querySelectorAll<HTMLElement>("[data-browser-page-host]")).some(
      (host) => shownPageBox(host) !== null,
    );
  return new Promise<void>((resolve) => {
    if (ready()) return resolve();
    const stops = [useBrowserRuntimeStore, useWorkspaceStore].map((store) =>
      store.subscribe(() => {
        if (!ready()) return;
        stops.forEach((stop) => stop());
        resolve();
      }),
    );
  });
}

const appIdle = () =>
  new Promise<void>((resolve) => {
    if (typeof window.requestIdleCallback === "function")
      window.requestIdleCallback(() => resolve(), { timeout: 1500 });
    else window.setTimeout(resolve, 200);
  });

let prewarmQueue: Promise<void> = Promise.resolve();

export function prewarmTurn() {
  let release = () => {};
  const finished = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  const ready = prewarmQueue.then(frontPageShown).then(appIdle);
  prewarmQueue = ready.then(() => finished);
  return { ready, release };
}

export function whenPageHostShown(host: HTMLElement) {
  let stop = () => {};
  const shown = new Promise<void>((resolve) => {
    const check = () => {
      if (!shownPageBox(host)) return;
      stop();
      resolve();
    };
    const resize = new ResizeObserver(check);
    const kept = new MutationObserver(check);
    resize.observe(host);
    kept.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden", "data-tab-kept"],
    });
    stop = () => {
      resize.disconnect();
      kept.disconnect();
    };
  });
  return { shown, stop: () => stop() };
}
