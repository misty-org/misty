import { useActivityStore } from "@/features/activity";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { onAction, onNotificationReceived } from "@tauri-apps/plugin-notification";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

/** Keeps every notification envelope private and funnels taps through Activity. */
export function MobileNotificationBridge() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!hasTauriInternals()) return;
    let active = true;
    const listeners = Promise.all([
      onAction(() => {
        if (active) navigate("/activity");
      }),
      onNotificationReceived(() => {
        if (active) void useActivityStore.getState().refresh();
      }),
    ]);
    return () => {
      active = false;
      void listeners.then((items) => Promise.all(items.map((item) => item.unregister())));
    };
  }, [navigate]);

  return null;
}
