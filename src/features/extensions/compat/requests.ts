import { extensionsNative } from "../native";
import type { ExtensionEvent } from "../types";
import { bookmarkHandlers, watchBookmarks } from "./bookmarks";
import { downloadHandlers, watchDownloads } from "./downloads";
import type { CompatHandler } from "./events";
import { historyHandlers, watchVisits } from "./history";
import { tabGroupHandlers, watchTabGroups } from "./tabGroups";
import { workspaceHandlers } from "./workspace";

const handlers: Record<string, CompatHandler> = {
  ...downloadHandlers,
  ...historyHandlers,
  ...workspaceHandlers,
  ...bookmarkHandlers,
  ...tabGroupHandlers,
};

/**
 * Answers one compatibility request from an extension. Misty's native host has
 * already checked that the extension holds the namespace's permission.
 */
export async function answerCompatRequest(event: ExtensionEvent): Promise<void> {
  if (!event.requestId || !event.method) return;
  const requestId = event.requestId;
  try {
    const handler = handlers[event.method];
    if (!handler) throw new Error(`${event.method} is not available in Misty.`);
    const result = await handler(Array.isArray(event.args) ? event.args : [], {
      id: String(event.id ?? ""),
      privateAccess: event.privateAccess ?? false,
    });
    await extensionsNative.compat("compat-reply", { requestId, result: result ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await extensionsNative.compat("compat-reply", { requestId, error: message }).catch(() => {});
  }
}

/** Starts the app-side sources of extension events. Returns a stop function. */
export function startCompatEvents(): () => void {
  const stops = [watchDownloads(), watchVisits(), watchBookmarks(), watchTabGroups()];
  return () => stops.forEach((stop) => stop());
}
