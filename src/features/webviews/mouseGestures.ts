import { invoke } from "@tauri-apps/api/core";

let pushed: boolean | null = null;

/** Mouse gestures in browser pages (right-drag left, right or up: back, forward, reload). */
export function configureBrowserMouseGestures(enabled: boolean): void {
  if (pushed === enabled) return;
  pushed = enabled;
  void invoke<void>("browser_set_mouse_gestures", { enabled }).catch(() => {
    pushed = null;
  });
}
