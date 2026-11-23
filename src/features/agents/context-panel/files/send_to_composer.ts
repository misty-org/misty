import { mentionOf } from "../../conversations/composer/controls/composer_triggers";
import { useMistyStore } from "../../conversations/state/use_misty_store";

function relativeToFolder(folder: string, path: string): string | null {
  const base = folder.replace(/\\/g, "/").replace(/\/+$/, "");
  const target = path.replace(/\\/g, "/").replace(/\/+$/, "");
  if (target === base) return "";
  if (!target.startsWith(`${base}/`)) return null;
  return target.slice(base.length + 1);
}

export function sendPathToComposer(folder: string, path: string, isDir: boolean) {
  const relative = relativeToFolder(folder, path);
  const named = relative === null ? path : relative || ".";
  const chat = useMistyStore.getState();
  const before = chat.query;
  const gap = before && !/\s$/.test(before) ? " " : "";
  chat.setQuery(`${before}${gap}${mentionOf(isDir && named !== "." ? `${named}/` : named)}`);
}
