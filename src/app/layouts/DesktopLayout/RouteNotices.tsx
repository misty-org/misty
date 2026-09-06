import type { AppNoticeEntry, AppNoticeSource } from "@/app/layouts/model/types";
import { reportSystemError } from "@/features/support/systemErrors";
import type { AppTab } from "@/features/app-shell";
import { useAppStore } from "@/features/app-shell";
import { useSettingsStore } from "@/features/settings";
import { Notification } from "@/shared/ui";
import { memo, useEffect, useRef } from "react";
export const RouteNotice = memo(function RouteNotice(props: { routeId: AppTab }) {
  const appError = useAppStore((state) => state.error);
  const appMessage = useAppStore((state) => state.message);
  const settingsError = useSettingsStore((state) => state.error);
  const settingsMessage = useSettingsStore((state) => state.message);
  const notice = noticeForRoute(props.routeId, {
    app: { error: appError, message: appMessage },
    settings: { error: settingsError, message: settingsMessage },
  });
  const dismissNotice = () => {
    useAppStore.getState().clearNotice();
    useSettingsStore.setState({ error: null, message: null });
  };

  useEffect(() => {
    if (!notice.error) return;
    const timeoutMs = 5500;
    const timer = window.setTimeout(dismissNotice, timeoutMs);
    return () => window.clearTimeout(timer);
  }, [notice.error]);

  if (!notice.message) return null;

  return (
    <Notification key={notice.message} tone="success" duration={3500} onDismiss={dismissNotice}>
      {notice.message}
    </Notification>
  );
});

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
      if (kind === "error") {
        reportSystemError({
          title: `${appNoticeSourceLabel(source)} encountered a problem`,
          error: message,
          scope: `app-notice:${source}`,
        });
        continue;
      }
    }
  }, [appError, appMessage, settingsError, settingsMessage]);

  return null;
});

function noticeForRoute(
  route: AppTab,
  notices: Record<"app" | "settings", { error: string | null; message: string | null }>,
) {
  const scoped = route === "settings" ? notices[route] : notices.app;
  return {
    error: scoped.error ?? notices.app.error,
    message: scoped.message ?? notices.app.message,
  };
}

function appNoticeSourceLabel(source: AppNoticeSource): string {
  switch (source) {
    case "settings":
      return "Settings";
    case "app":
      return "Misty";
  }
}
