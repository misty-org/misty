import { useSyncExternalStore } from "react";

export function isWindowViewing(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState === "visible" && document.hasFocus();
}

function subscribe(listener: () => void): () => void {
  document.addEventListener("visibilitychange", listener);
  window.addEventListener("focus", listener);
  window.addEventListener("blur", listener);
  return () => {
    document.removeEventListener("visibilitychange", listener);
    window.removeEventListener("focus", listener);
    window.removeEventListener("blur", listener);
  };
}

export function useWindowViewing(): boolean {
  return useSyncExternalStore(subscribe, isWindowViewing, () => true);
}
