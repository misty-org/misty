import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hasTauriInternals } from "@/platform/tauri";

export function useUnreadBadgeSync(params: { badgeCountEnabled: boolean; unreadActivityCount: number }) {
  const { badgeCountEnabled, unreadActivityCount } = params;

  useEffect(() => {
    const badgeCount = badgeCountEnabled && unreadActivityCount > 0 ? unreadActivityCount : undefined;
    try {
      if (!hasTauriInternals()) return;
      void getCurrentWindow()
        .setBadgeCount(badgeCount)
        .catch(() => {
          // Some platforms or browser test contexts do not support app badge counts.
        });
    } catch {
      // Some platforms or browser test contexts do not support app badge counts.
    }
  }, [badgeCountEnabled, unreadActivityCount]);
}
