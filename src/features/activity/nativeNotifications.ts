import { selectNotificationPreferences, useSettingsStore } from "@/features/settings";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type { ActivityItem, NativeNotificationPermission } from "./types";
import { isNativeMobileBuild } from "@/shared/platform/buildTarget";
import { useActivityStore } from "./useActivityStore";

const permissionDeniedStorageKey = "misty:activity:notification-permission-denied";

export async function nativeNotificationPermission(): Promise<NativeNotificationPermission> {
  if (!hasTauriInternals()) return "unsupported";
  try {
    if (await isPermissionGranted()) return "granted";
    return readPermissionDenied() ? "denied" : "prompt";
  } catch {
    return "unsupported";
  }
}

/** Must only be called from a user-initiated interaction. */
export async function requestNativeNotificationPermission(): Promise<NativeNotificationPermission> {
  if (!hasTauriInternals()) return "unsupported";
  try {
    const permission = await requestPermission();
    if (permission === "granted") {
      writePermissionDenied(false);
      return "granted";
    }
    if (permission === "denied") {
      writePermissionDenied(true);
      return "denied";
    }
    writePermissionDenied(false);
    return "prompt";
  } catch {
    writePermissionDenied(true);
    return "denied";
  }
}

export async function publishNativeActivity(item: ActivityItem): Promise<boolean> {
  if (!hasTauriInternals()) return false;
  const preferences = selectNotificationPreferences(useSettingsStore.getState().settings?.document);
  if (
    !preferences.desktopNotificationsEnabled ||
    preferences.quietHoursEnabled ||
    preferences.digestNotificationsEnabled
  ) {
    return false;
  }
  if (await mistyWindowIsFocused()) return false;
  if ((await nativeNotificationPermission()) !== "granted") return false;
  try {
    const mobileCount = Math.max(1, useActivityStore.getState().attentionCount);
    sendNotification({
      title: isNativeMobileBuild ? "Misty" : item.title,
      ...(isNativeMobileBuild
        ? { body: `${mobileCount} new ${mobileCount === 1 ? "update" : "updates"}.` }
        : item.body
          ? { body: item.body }
          : {}),
      ...(preferences.soundNotificationsEnabled ? { sound: "Ping" } : {}),
      group: "misty-activity",
      autoCancel: true,
    });
    return true;
  } catch {
    return false;
  }
}

export async function syncNativeBadge(count: number): Promise<void> {
  if (!hasTauriInternals()) return;
  const preferences = selectNotificationPreferences(useSettingsStore.getState().settings?.document);
  const badgeCount = preferences.badgeCountEnabled ? Math.max(0, Math.floor(count)) : 0;
  try {
    await getCurrentWindow().setBadgeCount(badgeCount > 0 ? badgeCount : undefined);
  } catch {
    // Dock/taskbar badging is platform dependent and should never break Activity.
  }
}

async function mistyWindowIsFocused(): Promise<boolean> {
  if (typeof document !== "undefined" && document.hasFocus()) return true;
  try {
    return await getCurrentWindow().isFocused();
  } catch {
    return typeof document !== "undefined" ? document.hasFocus() : true;
  }
}

function readPermissionDenied(): boolean {
  try {
    return localStorage.getItem(permissionDeniedStorageKey) === "true";
  } catch {
    return false;
  }
}

function writePermissionDenied(denied: boolean): void {
  try {
    if (denied) localStorage.setItem(permissionDeniedStorageKey, "true");
    else localStorage.removeItem(permissionDeniedStorageKey);
  } catch {
    // Permission state is still returned even when Web Storage is unavailable.
  }
}
