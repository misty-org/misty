import { invoke } from "@tauri-apps/api/core";
import { browserRuntimeIdForTabId } from "@/features/webviews/browserRuntime";
import { currentBrowserTab } from "./normalTabs";

/** What the video in front was saying, as a question at the cursor sends it. */
export interface MediaContext {
  title: string;
  url: string;
  /** Seconds into the video. */
  time: number;
  duration?: number | null;
  paused: boolean;
  /** Lines said from about 90 seconds before `time`, each with its start in seconds. */
  transcript: { t: number; text: string }[];
}

/** How long a turn waits for it after the screens are captured; it is never fetched then. */
const MEDIA_CONTEXT_BUDGET_MS = 300;

/**
 * What the front Misty tab is playing, with the captions its page already holds
 * (browser_media_context in browser/page_tools/media_tools/session.rs). Nothing when no video plays
 * there, the tab is private, or the page doesn't answer.
 */
export async function frontMediaContext(): Promise<MediaContext | undefined> {
  const tab = currentBrowserTab();
  const id = tab ? browserRuntimeIdForTabId(tab.id) : undefined;
  if (!id) return undefined;
  const context = await invoke<MediaContext | null>("browser_webview_media_context", {
    request: { id },
  }).catch(() => null);
  return context ?? undefined;
}

/**
 * Waits for a started lookup at most `budget` more milliseconds, so the companion
 * never sits silent on it: a turn without it still answers from the screens.
 */
export function withinBudget<T>(
  pending: Promise<T | undefined> | undefined,
  budget = MEDIA_CONTEXT_BUDGET_MS,
): Promise<T | undefined> {
  if (!pending) return Promise.resolve(undefined);
  return Promise.race([
    pending.catch(() => undefined),
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), budget)),
  ]);
}
