import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createDockLeaf } from "../panes/dockTree";
import type { WorkspaceTab, WorkspaceView } from "./workspaceViews";
import { tabFields } from "./profileTabRecord";

/**
 * What the renderer really writes, kept where a Rust test puts it through the real validator
 * (`src-tauri/features/browser/profiles/commands.rs`). A record the native side refuses never
 * syncs, and nobody sees why, so the two sides are checked against the same bytes. After a
 * deliberate change, rerun with `MISTY_UPDATE_BOUNDARY=1`.
 */
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
