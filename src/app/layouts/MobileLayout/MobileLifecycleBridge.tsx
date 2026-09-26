import { useActivityStore } from "@/features/activity";
import { useAuth } from "@/features/auth";
import { requestEmbeddedBrowserSuspension } from "@/shared/platform/browserSuspensionSignal";
import { useEffect } from "react";

/** Refresh account requests when returning to the foreground. */
export function MobileLifecycleBridge() {
  const { user } = useAuth();
  const accountId = user?.id ?? "";

  useEffect(() => {
    const refresh = async () => {
      if (!accountId || !navigator.onLine) return;
      await useActivityStore.getState().refresh();
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
