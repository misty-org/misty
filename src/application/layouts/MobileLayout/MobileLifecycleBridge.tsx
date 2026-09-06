import { useActivityStore } from "@/features/activity";
import { useAuth } from "@/features/auth";
import { useSpacesStore } from "@/features/spaces";
import { requestEmbeddedBrowserSuspension } from "@/shared/platform/browserSuspensionSignal";
import { useEffect } from "react";

/**
 * Misty is account-backed, so mobile resumes by refreshing authoritative
 * server state. App-owned drafts and caches belong to each installed app;
 * the core shell deliberately does not retain copies after uninstall.
 */
export function MobileLifecycleBridge() {
  const { user } = useAuth();
  const accountId = user?.id ?? "";

  useEffect(() => {
    const refresh = async () => {
      if (!accountId || !navigator.onLine) return;
      await Promise.allSettled([
        useSpacesStore.getState().load({ force: true, accountId }),
        useActivityStore.getState().refresh(),
      ]);
    };
    const online = () => void refresh();
    const visibility = () => {
      const hidden = document.visibilityState !== "visible";
      requestEmbeddedBrowserSuspension(hidden, "mobile-lifecycle");
      if (!hidden) void refresh();
    };
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", visibility);
    void refresh();
    return () => {
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", visibility);
      requestEmbeddedBrowserSuspension(false, "mobile-lifecycle");
    };
  }, [accountId]);

  return null;
}
