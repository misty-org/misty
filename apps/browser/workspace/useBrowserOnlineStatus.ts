import {
  blankBrowserUrl,
  browserHomeUrl,
  browserTabTitle,
  createBrowserTabState,
  useWorkspaceStore,
  type WorkspaceTab,
} from "@/features/workspace";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { browserRuntimeCreated, browserRuntimeId } from "./browserRuntime";

export function useBrowserOnlineStatus(
  tab: WorkspaceTab,
  currentUrl: string,
  nativeRuntime: boolean,
) {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const isOffline = !isOnline && currentUrl !== blankBrowserUrl;

  const handleRetry = () => {
    if (typeof navigator !== "undefined" && navigator.onLine) {
      setIsOnline(true);
    }
    if (nativeRuntime && browserRuntimeCreated(tab)) {
      void invoke("browser_webview_reload", {
        request: { id: browserRuntimeId(tab) },
      }).catch(() => undefined);
    }
  };

  const handleGoHome = () => {
    const home = browserHomeUrl();
    useWorkspaceStore.getState().updateBrowserTab(tab.id, {
      ...createBrowserTabState(home),
      title: browserTabTitle(home),
    });
  };

  return { isOffline, handleRetry, handleGoHome };
}
