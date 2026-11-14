// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
import { createDeviceSetting, type DeviceSetting } from "@/shared/lib/deviceSetting";
import { readStored } from "./filesStorage";
import { isUnder, treeLineage } from "./paths";

// What each linked folder's tree remembers for this device: its open folders and its open tabs.

/** Where a folder's open folders and tabs lived before `misty.db`; moved over on first use. */
export const treeKey = (root: string) => `misty.fileTree:${root}`;
export const tabsKey = (root: string) => `misty.editorTabs:${root}`;

/** Expanded paths whose every folder from the root down is expanded too. */
function reachableExpanded(root: string, expanded: Record<string, true>): Record<string, true> {
  const reachable: Record<string, true> = {};
  for (const path of Object.keys(expanded)) {
    if (treeLineage(root, path)?.every((dir) => expanded[dir])) reachable[path] = true;
  }
  return reachable;
}

interface SavedTabs {
  open: string[];
  active: string | null;
}

/** Each folder's entry, with when it was last used so the oldest can be let go. */
type PerFolder<T> = Record<string, T & { at: number }>;

/** Folders remembered at most per kind; the ones used longest ago are let go first. */
const keptFolders = 200;

function perFolder<T>(read: (entry: unknown) => T | null) {
  return (stored: unknown): PerFolder<T> => {
    const kept: PerFolder<T> = {};
    if (!stored || typeof stored !== "object") return kept;
    for (const [root, entry] of Object.entries(stored as Record<string, unknown>)) {
      const at = (entry as { at?: unknown } | null)?.at;
      const value = read(entry);
      if (value && typeof at === "number") kept[root] = { ...value, at };
    }
    return kept;
  };
}

const readTree = (value: unknown): { expanded: string[] } | null => {
  const paths = (value as { expanded?: unknown } | null)?.expanded;
  if (!Array.isArray(paths) || !paths.every((path) => typeof path === "string")) return null;
  return { expanded: paths };
};

const readTabsEntry = (value: unknown): SavedTabs | null => {
  const tabs = value as Partial<SavedTabs> | null;
  if (!Array.isArray(tabs?.open)) return null;
  return {
    open: tabs.open.filter((path): path is string => typeof path === "string"),
    active: typeof tabs.active === "string" ? tabs.active : null,
  };
};

/** Which folders were open in each linked folder's tree, kept for this device in `misty.db`. */
const savedTrees = createDeviceSetting<PerFolder<{ expanded: string[] }>>({
  scope: "file-tree-expanded",
  defaults: {},
  normalize: perFolder(readTree),
});

/** Which files were open as tabs in each linked folder, kept for this device in `misty.db`. */
const savedTabs = createDeviceSetting<PerFolder<SavedTabs>>({
  scope: "editor-tabs",
  defaults: {},
  normalize: perFolder(readTabsEntry),
});

/** Puts one folder's entry in the map, keeping only the most recently used folders. */
function keepFor<T>(root: string, value: T) {
  return (current: PerFolder<T>): PerFolder<T> => {
    const next = { ...current, [root]: { ...value, at: Date.now() } };
    const recent = Object.entries(next).sort(([, a], [, b]) => b.at - a.at);
    return Object.fromEntries(recent.slice(0, keptFolders));
  };
}

/** A folder's entry, or the one it had in webview storage before `misty.db`. The legacy key is
 * dropped here; the store's subscriber saves what the folder opens with right after. */
function savedFor<T>(
  setting: { getState(): DeviceSetting<PerFolder<T>> },
  legacyKey: string,
  root: string,
  read: (value: unknown) => T | null,
): T | null {
  const kept = setting.getState().value[root];
  if (kept) return kept;
  const legacy = readStored(legacyKey, read);
  try {
    localStorage.removeItem(legacyKey);
  } catch {
    // Storage is off, so there was nothing to move.
  }
  return legacy;
}

export function readExpanded(root: string): Record<string, true> {
  const saved = root ? savedFor(savedTrees, treeKey(root), root, readTree) : null;
  if (!saved) return root ? { [root]: true } : {};
  return reachableExpanded(root, Object.fromEntries(saved.expanded.map((path) => [path, true])));
}

export function readTabs(root: string): SavedTabs {
  const saved = savedFor(savedTabs, tabsKey(root), root, readTabsEntry);
  if (!saved) return { open: [], active: null };
  const open = saved.open.filter((path) => isUnder(path, root));
  return { open, active: saved.active && open.includes(saved.active) ? saved.active : null };
}

/** Saves which folders are open in `root`'s tree. */
export function saveExpanded(root: string, expanded: Record<string, true>) {
  savedTrees
    .getState()
    .set(keepFor(root, { expanded: Object.keys(reachableExpanded(root, expanded)) }));
}

/** Saves which files are open as tabs in `root`, and the active one. */
export function saveTabs(root: string, open: string[], active: string | null) {
  savedTabs.getState().set(keepFor(root, { open, active }));
}
