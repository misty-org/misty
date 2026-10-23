import { invoke } from "@tauri-apps/api/core";

let pushed: number | null = null;

/** How long a hidden browser tab keeps drawing before it sleeps, in seconds; 0 never sleeps it. */
export function configureHiddenTabSleep(seconds: number): void {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
  if (pushed === value) return;
  pushed = value;
  void invoke<void>("browser_set_hidden_tab_sleep", { seconds: value }).catch(() => {
    pushed = null;
  });
}
