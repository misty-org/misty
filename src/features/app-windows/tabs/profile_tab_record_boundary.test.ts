import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createDockLeaf } from "../panes/dock_tree";
import type { WorkspaceTab, WorkspaceView } from "./workspace_views";
import { tabFields } from "./profile_tab_record";

const fixture = resolve(
  __dirname,
  "../../../../src-tauri/features/browser/profiles/testdata/renderer_records.json",
);

const page = (id: string): WorkspaceView => ({
  id,
  surfaceId: "agents",
  groupKey: "tool:agents",
  instanceKey: id,
  title: "Agents",
  route: "/agents?chat=one",
  sidebarVisible: true,
  state: null,
  createdAt: 1_700_000_000_000,
  lastFocusedAt: 1_700_000_000_000,
});

const tab = (id: string, extra: Partial<WorkspaceTab> = {}): WorkspaceTab => {
  const pane = { ...createDockLeaf([page(`view-${id}`)]), id: `pane-${id}` };
  return { id, root: pane, focusedPaneId: pane.id, ...extra };
};

function generated() {
  return {
    tabs: [{ id: "layout:one", fields: tabFields(tab("layout:one", { title: "Named" }), 0) }],
  };
}

describe("records crossing to the native side", () => {
  it("are the ones the native validator is tested against", () => {
    const now = JSON.parse(JSON.stringify(generated())) as unknown;
    if (process.env.MISTY_UPDATE_BOUNDARY)
      writeFileSync(fixture, `${JSON.stringify(now, null, 2)}\n`);
    expect(now).toEqual(JSON.parse(readFileSync(fixture, "utf8")));
  });
});
