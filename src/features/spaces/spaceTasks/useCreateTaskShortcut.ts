import { useEffect } from "react";
import { isTypingTarget } from "./taskFiltering";

/** Press "c" anywhere outside a text field to open the new-task drawer. */
export function useCreateTaskShortcut(enabled: boolean, onCreate: () => void) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "c" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isTypingTarget(event.target)
      )
        return;
      event.preventDefault();
      onCreate();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, onCreate]);
}
