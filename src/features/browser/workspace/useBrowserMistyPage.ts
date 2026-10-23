import type { WorkspaceView } from "@/features/workspace";
import { browserRuntimeCreated, type BrowserMistyPage } from "@/features/webviews/browserRuntime";
import { useEffect, useState } from "react";
import { inspectBrowserPage } from "./browserPageInspection";
import { setBrowserError } from "./browserErrors";
import { useBrowserMistyAiAdapter } from "./useBrowserMistyAiAdapter";

/** The page context a person attaches to Misty from the browser menu, cleared on navigation. */
export function useBrowserMistyPage(tab: WorkspaceView, url: string, nativeRuntime: boolean) {
  const [mistyPage, setMistyPage] = useState<BrowserMistyPage | null>(null);
  const [mistyPageLoading, setMistyPageLoading] = useState(false);
  useBrowserMistyAiAdapter(tab, mistyPage, nativeRuntime);
  useEffect(() => setMistyPage(null), [url]);
  const attachPageToMisty = async () => {
    if (!nativeRuntime || !browserRuntimeCreated(tab)) {
      setBrowserError(
        tab.id,
        "Page context is unavailable on this platform or before the page opens.",
      );
      return;
    }
    setMistyPageLoading(true);
    try {
      setMistyPage(await inspectBrowserPage(tab, url));
    } catch (error) {
      setBrowserError(tab.id, error);
    } finally {
      setMistyPageLoading(false);
    }
  };
  return { mistyPage, mistyPageLoading, attachPageToMisty };
}
