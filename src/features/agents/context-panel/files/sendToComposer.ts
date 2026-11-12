import { mentionOf } from "../../conversations/composer/controls/composerTriggers";
import { useMistyStore } from "../../conversations/state/useMistyStore";

/** `path` relative to `folder`, with `/` between names, or null when it lies outside. */
export function relativeToFolder(folder: string, path: string): string | null {
  const base = folder.replace(/\\/g, "/").replace(/\/+$/, "");
  const target = path.replace(/\\/g, "/").replace(/\/+$/, "");
  if (target === base) return "";
  if (!target.startsWith(`${base}/`)) return null;
  return target.slice(base.length + 1);
}

/**
 * Puts an `@` mention of a file or folder into the open chat's composer, after what is already
 * written there, the way the composer's own `@` menu writes one. Nothing is sent.
 */
export function sendPathToComposer(folder: string, path: string, isDir: boolean) {
  const relative = relativeToFolder(folder, path);
  const named = relative === null ? path : relative || ".";
  const chat = useMistyStore.getState();
  const before = chat.query;
  const gap = before && !/\s$/.test(before) ? " " : "";
  chat.setQuery(`${before}${gap}${mentionOf(isDir && named !== "." ? `${named}/` : named)}`);
}
