import { useEffect } from "react";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { listenBrowserInteractionEvents } from "./browserInteractionListeners";
import { observePageBackgroundHosts } from "./browserPageBackgrounds";
import { listenBrowserPageEvents } from "./browserPageListeners";

/** Subscribes to every native browser event the desktop shell emits. */
export function useBrowserNativeEvents(): void {
  useEffect(() => {
    if (!hasTauriInternals()) return;
    let disposed = false;
    const isDisposed = () => disposed;
    const pageBackgrounds = new Map<string, string>();
    const stopBackgroundHosts = observePageBackgroundHosts(pageBackgrounds);
    const listeners = Promise.all([
      ...listenBrowserPageEvents({ isDisposed, pageBackgrounds }),
      ...listenBrowserInteractionEvents({ isDisposed }),
    ]);
    return () => {
      disposed = true;
      stopBackgroundHosts();
      void listeners.then((unlisten) => unlisten.forEach((stop) => stop()));
    };
  }, []);
}
