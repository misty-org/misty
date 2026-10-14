import { browserTabIdForRuntime } from "./browserRuntime";

export function restorePageBackgrounds(pageBackgrounds: Map<string, string>): void {
  for (const [id, color] of pageBackgrounds) {
    const tabId = browserTabIdForRuntime(id);
    if (!tabId) {
      pageBackgrounds.delete(id);
      continue;
    }
    const host = document.querySelector<HTMLElement>(
      `[data-browser-workspace-tab="${CSS.escape(tabId)}"] [data-browser-page-host]`,
    );
    if (!host) continue;
    if (host.dataset.mistyBrowserBackground !== color) {
      host.dataset.mistyBrowserBackground = color;
    }
    // Paint the host like the page so a live resize never shows a gap.
    if (host.style.getPropertyValue("--browser-page-background") !== color) {
      host.style.setProperty("--browser-page-background", color);
    }
  }
}

/** Returns a stop function that disconnects the observer and cancels its pending restore. */
export function observePageBackgroundHosts(pageBackgrounds: Map<string, string>): () => void {
  let backgroundTimer: ReturnType<typeof setTimeout> | undefined;
  // Native pages survive shell host remounts. Restore their last color when
  // React recreates a host, even if the website itself hasn't changed color.
  const backgroundHosts = new MutationObserver(() => {
    clearTimeout(backgroundTimer);
    restorePageBackgrounds(pageBackgrounds);
    backgroundTimer = setTimeout(() => restorePageBackgrounds(pageBackgrounds), 60);
  });
  backgroundHosts.observe(document.body, {
    childList: true,
    subtree: true,
  });
  return () => {
    clearTimeout(backgroundTimer);
    backgroundHosts.disconnect();
  };
}
