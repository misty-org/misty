import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { setBrowserError } from "./browserErrors";
import { browserThemeFromDocument } from "./browserTheme";
import type { BrowserTheme } from "./types";

/** Follows the app theme and tells the native pages which theme to use. */
export function useBrowserTheme(tabId: string, nativeRuntime: boolean): BrowserTheme {
  const [browserTheme, setBrowserTheme] = useState<BrowserTheme>(browserThemeFromDocument);
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
    void invoke("browser_webview_set_theme", {
      request: {
        theme: browserTheme,
      },
    }).catch((error: unknown) => setBrowserError(tabId, error));
  }, [browserTheme, nativeRuntime, tabId]);
  return browserTheme;
}
