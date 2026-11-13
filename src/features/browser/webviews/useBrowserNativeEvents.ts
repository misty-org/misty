import { useEffect } from "react";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { listenBrowserInteractionEvents } from "./browserInteractionListeners";
import { listenBrowserPageEvents } from "./browserPageListeners";

/** Subscribes to every native browser event the desktop shell emits. */
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
