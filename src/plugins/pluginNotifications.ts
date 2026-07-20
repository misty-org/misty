import type { PluginPanelNotification } from "../api/types";
import { useExplorerStore } from "../stores/useExplorerStore";

type PluginNotificationType = "info" | "success" | "error";

function notificationType(level: string): PluginNotificationType {
  if (level === "success" || level === "error") return level;
  return "info";
}

function notificationText(notification: PluginPanelNotification): string {
  const title = notification.title.trim();
  const message = notification.message.trim();
  if (title && message) return `${title}: ${message}`;
  return title || message;
}

export function publishPluginNotifications(
  notifications: readonly PluginPanelNotification[] | undefined,
  fallbackMessage?: string,
): boolean {
  const pushNotification = useExplorerStore.getState().pushNotification;
  const published = (notifications ?? [])
    .map((notification) => ({
      text: notificationText(notification),
      type: notificationType(notification.level),
    }))
    .filter((notification) => notification.text.length > 0);

  for (const notification of published) {
    pushNotification(
      notification.text,
      notification.type,
      notification.type === "error" ? 4500 : 3500,
      true,
    );
  }

  if (published.length > 0) return true;

  const fallback = fallbackMessage?.trim();
  if (fallback) {
    pushNotification(fallback, "info", 2500, false);
    return true;
  }

  return false;
}
