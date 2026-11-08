import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createDockLeaf } from "../panes/dockTree";
import {
  createBrowserViewState,
  type WorkspaceTab,
  type WorkspaceView,
} from "../tabs/workspaceViews";
import { localProfileRecords } from "./profileRecords";
import { tabFields } from "../tabs/profileTabRecord";
import type { MistyTabGroup } from "../tab-groups/tabGroups";

/**
 * What the renderer really writes, kept where a Rust test puts it through the real validator
 * (`infra/profile_data/commands.rs`). A record the native side refuses never syncs, and nobody
 * sees why, so the two sides are checked against the same bytes. After a deliberate change, rerun
 * with `MISTY_UPDATE_BOUNDARY=1`.
 */
const fixture = resolve(
  __dirname,
  "../../../../src-tauri/features/browser/profiles/testdata/renderer_records.json",
);

const page = (id: string, url: string): WorkspaceView => ({
  id,
  surfaceId: "browser",
  groupKey: "tool:browser",
  instanceKey: id,
  title: "Example",
  route: "/browser",
  sidebarVisible: true,
  state: createBrowserViewState(url),
  createdAt: 1_700_000_000_000,
  lastFocusedAt: 1_700_000_000_000,
});

const tab = (id: string, url: string, extra: Partial<WorkspaceTab> = {}): WorkspaceTab => {
  const pane = { ...createDockLeaf([page(`view-${id}`, url)]), id: `pane-${id}` };
  return { id, root: pane, focusedPaneId: pane.id, ...extra };
};

const groups: MistyTabGroup[] = [
  { id: "group-open", name: "Open group", color: "blue", collapsed: false },
  {
    id: "group-saved",
    name: "Saved group",
    color: "purple",
    collapsed: true,
    savedTabs: [tab("layout:saved", "https://saved.example/")],
  },
];

function generated() {
  const state = {
    tabGroups: groups,
    bookmarkFolders: [
      {
        kind: "folder" as const,
        id: "folder-root",
        fields: { label: "Bookmarks bar", icon: "folder", order: 0, hidden: false },
      },
      {
        kind: "folder" as const,
        id: "folder-child",
        fields: {
          label: "Reading",
          icon: "folder",
          order: 1,
          hidden: false,
          parent_id: "folder-root",
          added_at: 1_700_000_000_000,
        },
      },
    ],
    bookmarks: [
      {
        kind: "bookmark" as const,
        id: "bookmark-one",
        fields: {
          folder_id: "folder-child",
          title: "Example",
          url: "https://example.com/",
          order: 0,
          pinned: true,
          added_at: 1_700_000_000_000,
        },
      },
    ],
  };
  return {
    bookmarks: localProfileRecords("bookmarks", state),
    tab_groups: localProfileRecords("tab_groups", state),
    tabs: [
      {
        id: "layout:one",
        fields: tabFields(
          tab("layout:one", "https://example.com/page", {
            tabGroupId: "group-open",
            pinnedUrl: "https://example.com/",
          }),
          0,
          groups,
        ),
      },
    ],
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
