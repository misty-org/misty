import { isPermissionGranted, sendNotification } from "@tauri-apps/plugin-notification";
import { useBrowserDownloadsStore } from "@/features/browser";
import { browserLibrary } from "@/features/browser";
import { compatObject, compatTime, emitCompatEvent, type CompatHandler } from "./events";

/** Notifications each extension has shown, keyed by installation id. */
const shown = new Map<string, Set<string>>();

function notificationsOf(id: string): Set<string> {
  let set = shown.get(id);
  if (!set) shown.set(id, (set = new Set()));
  return set;
}

async function notify(options: Record<string, unknown>): Promise<void> {
  if (!(await isPermissionGranted())) throw new Error("Notifications are turned off for Misty.");
  const title = String(options.title ?? "").slice(0, 256);
  const items = Array.isArray(options.items)
    ? options.items.map((item) =>
        `${String(compatObject(item).title ?? "")} ${String(compatObject(item).message ?? "")}`.trim(),
      )
    : [];
  const body = [String(options.message ?? ""), ...items].filter(Boolean).join("\n").slice(0, 2048);
  sendNotification({ title, ...(body ? { body } : {}), autoCancel: true });
}

export const systemHandlers: Record<string, CompatHandler> = {
  // Clicks and buttons are not reported back; macOS shows the notification as Misty's.
  "notifications.create": async ([name, options], caller) => {
    await notify(compatObject(options));
    notificationsOf(caller.id).add(String(name));
    emitCompatEvent("notifications.onShown", [String(name)], { id: caller.id });
  },
  "notifications.update": async ([name, options], caller) => {
    if (!notificationsOf(caller.id).has(String(name))) return false;
    await notify(compatObject(options));
    return true;
  },
  "notifications.clear": ([name], caller) => {
    const removed = notificationsOf(caller.id).delete(String(name));
    if (removed)
      emitCompatEvent("notifications.onClosed", [String(name), false], { id: caller.id });
    return removed;
  },
  "notifications.getAll": (_, caller) =>
    Object.fromEntries([...notificationsOf(caller.id)].map((name) => [name, true])),

  // The native host has already removed website data; history and downloads remain.
  "browsingData.remove": async ([options, types]) => {
    const scope = compatObject(options);
    const data = compatObject(types);
    if (Array.isArray(scope.hostnames) || Array.isArray(scope.origins))
      throw new Error("Misty removes history and downloads for all sites at once.");
    const since = compatTime(scope.since, 0);
    if (data.history) await browserLibrary.clearHistory({ since });
    if (data.downloads) {
      await browserLibrary.removeDownloads({ since });
      await useBrowserDownloadsStore.getState().refresh();
    }
  },
};
