import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { setBrowserError } from "./browserErrors";
import { browserThemeFromDocument } from "./browserTheme";
import type { BrowserTheme } from "@/features/webviews/types";

/** Follows the app theme and tells the native pages which theme to use. */
export function useBrowserTheme(tabId: string, nativeRuntime: boolean): BrowserTheme {
  const [browserTheme, setBrowserTheme] = useState<BrowserTheme>(browserThemeFromDocument);
  // The native WebView receives this theme in browser_webview_create. Avoid
  // replaying it when the page component mounts: that command updates the
  // native window and every browser WebView, which can repaint native chrome
  // after the page has already painted.
  const lastAppliedTheme = useRef(browserTheme);
  useEffect(() => {
    const root = document.documentElement;
    const colorScheme =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: light)")
        : null;
    const syncTheme = () => setBrowserTheme(browserThemeFromDocument());
    const observer = new MutationObserver(syncTheme);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme", "data-theme-mode"],
    });
    colorScheme?.addEventListener("change", syncTheme);
    return () => {
      observer.disconnect();
      colorScheme?.removeEventListener("change", syncTheme);
    };
  }, []);
  useEffect(() => {
    if (!nativeRuntime) return;
    if (lastAppliedTheme.current === browserTheme) return;
    lastAppliedTheme.current = browserTheme;
    void invoke("browser_webview_set_theme", {
      request: {
        theme: browserTheme,
      },
    }).catch((error: unknown) => setBrowserError(tabId, error));
  }, [browserTheme, nativeRuntime, tabId]);
  return browserTheme;
}
