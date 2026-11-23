// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import type { ClipboardFileSnapshot } from "./files_api";
import type { TreeClipboard } from "./files_store";

export type PasteSource = "tree" | "system" | "none";

export function choosePasteSource(
  snapshot: ClipboardFileSnapshot,
  tree: TreeClipboard | null,
): PasteSource {
  if (tree) {
    const comparable = snapshot.changeCount !== null && tree.osChangeCount != null;
    if (!comparable || snapshot.changeCount === tree.osChangeCount) return "tree";
  }
  return snapshot.paths.length > 0 ? "system" : "none";
}
