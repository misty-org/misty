import { memo, useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useExplorerStore } from "@/stores/explorer";
import type { ExplorerNotificationType } from "@/stores/explorer";
import { useProvidersStore } from "@/stores/providers";
import { useTransfersStore } from "@/stores/transfers";
import { selectNotificationPreferences, useAppStore, useSettingsStore } from "@/stores/app";
import type { AppTab } from "@/models/types/routing/types";
import type { AppNoticeEntry, AppNoticeKind, AppNoticeSource } from "@/models/types/layouts";
import { globalBannerBaseClass, globalNoticeLayerClass } from "./styles";

export const RouteNotice = memo(function RouteNotice(props: { routeId: AppTab }) {
  const appError = useAppStore((state) => state.error);
  const appMessage = useAppStore((state) => state.message);
  const providerError = useProvidersStore((state) => state.error);
  const providerMessage = useProvidersStore((state) => state.message);
  const transferError = useTransfersStore((state) => state.error);
  const transferMessage = useTransfersStore((state) => state.message);
  const settingsError = useSettingsStore((state) => state.error);
  const settingsMessage = useSettingsStore((state) => state.message);
  const notificationPreferences = useSettingsStore(
    useShallow((state) => selectNotificationPreferences(state.settings?.document)),
  );
  const notice = noticeForRoute(props.routeId, {
    app: { error: appError, message: appMessage },
    providers: { error: providerError, message: providerMessage },
    transfers: { error: transferError, message: transferMessage },
    settings: { error: settingsError, message: settingsMessage },
  });
  const showMessage =
    notificationPreferences.inAppNotificationsEnabled && !notificationPreferences.quietHoursEnabled;

  if (!notice.error && !(showMessage && notice.message)) return null;

  return (
    <div className={globalNoticeLayerClass}>
      {notice.error ? (
        <div
          className={`${globalBannerBaseClass} border-[color-mix(in_srgb,var(--misty-danger)_42%,#2f3338)] text-[var(--misty-danger)]`}
        >
          {notice.error}
        </div>
      ) : null}
      {showMessage && notice.message ? (
        <div
          className={`${globalBannerBaseClass} border-[color-mix(in_srgb,var(--misty-success)_38%,#2f3338)] text-[var(--misty-success)]`}
        >
          {notice.message}
        </div>
      ) : null}
    </div>
  );
});

export const AppNoticePublisher = memo(function AppNoticePublisher() {
  const appError = useAppStore((state) => state.error);
  const appMessage = useAppStore((state) => state.message);
  const providerError = useProvidersStore((state) => state.error);
  const providerMessage = useProvidersStore((state) => state.message);
  const transferError = useTransfersStore((state) => state.error);
  const transferMessage = useTransfersStore((state) => state.message);
  const settingsError = useSettingsStore((state) => state.error);
  const settingsMessage = useSettingsStore((state) => state.message);
  const lastPublished = useRef<Record<string, string>>({});

  useEffect(() => {
    const entries = [
      ["app", "error", appError],
      ["app", "message", appMessage],
      ["providers", "error", providerError],
      ["providers", "message", providerMessage],
      ["transfers", "error", transferError],
      ["transfers", "message", transferMessage],
      ["settings", "error", settingsError],
      ["settings", "message", settingsMessage],
    ] satisfies AppNoticeEntry[];
    const pushNotification = useExplorerStore.getState().pushNotification;

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
      pushNotification(
        `${appNoticeSourceLabel(source)}: ${message}`,
        appNoticeType(kind),
        kind === "error" ? 5500 : 3500,
        false,
      );
    }
  }, [
    appError,
    appMessage,
    providerError,
    providerMessage,
    transferError,
    transferMessage,
    settingsError,
    settingsMessage,
  ]);

  return null;
});

function noticeForRoute(
  route: AppTab,
  notices: Record<
    "app" | "providers" | "transfers" | "settings",
    { error: string | null; message: string | null }
  >,
) {
  const scoped =
    route === "providers" || route === "transfers" || route === "settings"
      ? notices[route]
      : notices.app;
  return {
    error: scoped.error ?? notices.app.error,
    message: scoped.message ?? notices.app.message,
  };
}

function appNoticeSourceLabel(source: AppNoticeSource): string {
  switch (source) {
    case "providers":
      return "Remotes";
    case "transfers":
      return "Transfers";
    case "settings":
      return "Settings";
    case "app":
      return "Misty";
  }
}

function appNoticeType(kind: AppNoticeKind): ExplorerNotificationType {
  return kind === "error" ? "error" : "success";
}
