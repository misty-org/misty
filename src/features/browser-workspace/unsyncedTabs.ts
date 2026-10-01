import { allLayoutViews, paneViewLabel } from "@/features/workspace/layoutTabs";
import type { WorkspaceView, WorkspaceWindow } from "@/features/workspace/model";
import type { SyncState } from "./native";

export interface UnsyncedTabRow {
  id: string;
  title: string;
  state: "waiting" | "closed" | "arrangement" | "kept";
}

/** Names what is not synced yet, per tab: waiting changes to open tabs, tabs
 * closed here whose close has not synced, one row for tab and window
 * arrangement, and edits an older version kept on this device. */
export function unsyncedTabRows(
  sync: Pick<SyncState, "unsynced" | "retired_edits"> | null | undefined,
  windows: WorkspaceWindow[],
): UnsyncedTabRow[] {
  const open = new Map<string, WorkspaceView>();
  for (const window of windows)
    for (const view of allLayoutViews(window.layout)) open.set(view.id, view);
  const rows: UnsyncedTabRow[] = [];
  let arrangement = false;
  for (const record of sync?.unsynced ?? []) {
    if (record.kind !== "view") {
      // Layout, window and group records: where tabs sit, not what they show.
      if (["tab", "window", "tab_group"].includes(record.kind)) arrangement = true;
      continue;
    }
    const view = open.get(record.id);
    rows.push({
      id: record.id,
      title: view ? paneViewLabel(view) : record.title || "Untitled tab",
      state: record.deleted ? "closed" : "waiting",
    });
  }
  rows.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  if (arrangement) rows.push({ id: "arrangement", title: "Tab arrangement", state: "arrangement" });
  const kept = sync?.retired_edits ?? 0;
  if (kept)
    rows.push({
      id: "kept",
      title: `${kept} earlier set${kept === 1 ? "" : "s"} of changes`,
      state: "kept",
    });
  return rows;
}
