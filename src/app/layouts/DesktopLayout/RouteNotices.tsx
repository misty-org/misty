import type { AppNoticeEntry, AppNoticeSource } from "@/app/layouts/desktop-state";
import { reportSystemError } from "@/shared/platform/systemErrors";
import { useAppStore } from "@/app/shell";
import { useSettingsStore } from "@/features/settings";
import { notify } from "@/shared/ui";
import { memo, useEffect, useRef } from "react";

/**
 * What the app and settings stores have to say. A message is a notice that leaves on its own; an
 * error goes to the system error report, which says what failed. Each is said once, then cleared:
 * a message when its notice leaves, an error a few seconds after it was reported.
 */
export const AppNoticePublisher = memo(function AppNoticePublisher() {
  const appError = useAppStore((state) => state.error);
  const appMessage = useAppStore((state) => state.message);
  const settingsError = useSettingsStore((state) => state.error);
  const settingsMessage = useSettingsStore((state) => state.message);
  const lastPublished = useRef<Record<string, string>>({});

  useEffect(() => {
    const entries = [
      ["app", "error", appError],
      ["app", "message", appMessage],
      ["settings", "error", settingsError],
      ["settings", "message", settingsMessage],
    ] satisfies AppNoticeEntry[];
    for (const [source, kind, value] of entries) {
      const key = `${source}:${kind}`;
      const message = value?.trim() ?? "";
      if (!message) {
        lastPublished.current[key] = "";
        continue;
      }
      const signature = `${kind}:${message}`;
      if (lastPublished.current[key] === signature) continue;
      lastPublished.current[key] = signature;
      if (kind === "error")
        reportSystemError({
          title: `${appNoticeSourceLabel(source)} encountered a problem`,
          error: message,
          scope: `app-notice:${source}`,
        });
      else
        notify({
          id: key,
          message,
          duration: 3500,
          onDismiss: () => {
            if (source === "app") useAppStore.getState().setMessage(null);
            else useSettingsStore.setState({ message: null });
          },
        });
    }
  }, [appError, appMessage, settingsError, settingsMessage]);

  useEffect(() => {
    if (!appError && !settingsError) return;
    const timer = window.setTimeout(() => {
      useAppStore.setState({ error: null });
      useSettingsStore.setState({ error: null });
    }, 5500);
    return () => window.clearTimeout(timer);
  }, [appError, settingsError]);

  return null;
});

function appNoticeSourceLabel(source: AppNoticeSource): string {
  return source === "settings" ? "Settings" : "Misty";
}
