import { useEffect } from "react";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { listenBrowserInteractionEvents } from "./browser_interaction_listeners";
import { listenBrowserPageEvents } from "./browser_page_listeners";

export function useBrowserNativeEvents(): void {
  useEffect(() => {
    if (!hasTauriInternals()) return;
    let disposed = false;
    const isDisposed = () => disposed;
    const listeners = Promise.all([
      ...listenBrowserPageEvents({ isDisposed }),
      ...listenBrowserInteractionEvents({ isDisposed }),
    ]);
    return () => {
      disposed = true;
      void listeners.then((unlisten) => unlisten.forEach((stop) => stop()));
    };
  }, []);
}
