import { describe, expect, it } from "vitest";
import { dockLeaves } from "@/features/workspace/dockTree";
import type { DeviceSelection, SharedRecord, WorkspaceRecords } from "./model";
import { projectWorkspace, recoveryTabId } from "./projection";

const local = (): DeviceSelection => ({
  activeTabByWindow: {},
  activeViewByPane: {},
  focusedPaneByTab: {},
});
const view = (records: SharedRecord[]): WorkspaceRecords => ({
  version: 1,
  sequence: 3,
  records,
  resumes: {},
  orphaned_view_ids: [],
  orphaned_bookmark_ids: [],
});
const windowRecord = (id: string, order = 0): SharedRecord<"window"> => ({
  kind: "window",
  id,
  fields: { title: id, order },
});
const layoutRecord = (id: string, window: string, pane: string): SharedRecord<"tab"> => ({
  kind: "tab",
  id,
  fields: { window_id: window, title: "", order: 0, tree: { type: "leaf", id: pane } },
});
const tabRecord = (id: string, layout: string, pane: string): SharedRecord<"view"> => ({
  kind: "view",
  id,
  fields: {
    surface: "browser",
    title: id,
    placement: { tab_id: layout, pane_id: pane, order: 0 },
    url: `https://example.test/${id}`,
    profile_id: "a".repeat(64),
    bookmark_id: null,
    tool_route: null,
    agent_owned: false,
  },
});

function visibleTabIds(projected: ReturnType<typeof projectWorkspace>) {
  return projected.windows
    .flatMap((window) =>
      window.layout.tabs!.flatMap((layout) =>
        dockLeaves(layout.root).flatMap((pane) => pane.views.map((tab) => tab.id)),
      ),
    )
    .sort();
}

describe("native browser workspace projection", () => {
  it("preserves device-local window/layout focus while another device's resume changes", () => {
    const shared = view([
      windowRecord("window:a"),
      windowRecord("window:b", 1),
      layoutRecord("layout:a", "window:a", "pane:a"),
      layoutRecord("layout:b", "window:b", "pane:b"),
      tabRecord("tab:a", "layout:a", "pane:a"),
      tabRecord("tab:b", "layout:b", "pane:b"),
    ]);
    shared.resumes.other = {
      sequence: 3,
      resume: {
        active_window_id: "window:a",
        active_tab_id: "layout:a",
        focused_pane_id: "pane:a",
        active_view_by_pane: { "pane:a": "tab:a" },
      },
    };
    const selected = {
      ...local(),
      activeWindowId: "window:b",
      activeTabByWindow: { "window:b": "layout:b" },
    };
    expect(projectWorkspace(shared, selected).activeWindowId).toBe("window:b");
    expect(projectWorkspace(shared, selected).windows[1].layout.activeTabId).toBe("layout:b");
    shared.resumes.other.resume.active_window_id = "window:b";
    expect(
      projectWorkspace(shared, { ...local(), activeWindowId: "window:a" }).activeWindowId,
    ).toBe("window:a");
  });

  it("keeps every tab visible after concurrent split replacement or pane collisions", () => {
    const shared = view([
      windowRecord("window:a"),
      layoutRecord("layout:a", "window:a", "pane:kept"),
      tabRecord("tab:one", "layout:a", "pane:kept"),
      tabRecord("tab:two", "layout:a", "pane:removed"),
      tabRecord("tab:three", "layout:a", "pane:kept"),
    ]);
    const before = structuredClone(shared);
    const result = projectWorkspace(shared, {
      ...local(),
      activeViewByPane: { "pane:kept": "tab:three" },
    });
    expect(visibleTabIds(result)).toEqual(["tab:one", "tab:three", "tab:two"]);
    expect(result.windows[0].layout.tabs!.map((tab) => tab.id)).toContain(recoveryTabId("tab:two"));
    expect(result.recoveryViewIds).toEqual(["tab:one", "tab:two"]);
    expect(shared).toEqual(before);
    const again = projectWorkspace(shared, local());
    expect(visibleTabIds(again)).toEqual(visibleTabIds(result));
  });

  it("recovers orphaned views without recreating a deleted shared window", () => {
    const shared = view([
      layoutRecord("layout:deleted", "window:deleted", "pane:one"),
      tabRecord("tab:one", "layout:deleted", "pane:one"),
    ]);
    const result = projectWorkspace(shared, { ...local(), activeWindowId: "window:deleted" });
    expect(result.windows).toHaveLength(1);
    expect(result.windows[0].id).toBe("recovery:window");
    expect(visibleTabIds(result)).toEqual(["tab:one"]);
    expect(shared.records.some((record) => record.kind === "window")).toBe(false);
  });

  it("keeps launch URLs separate from the live tab URL and preserves profile references", () => {
    const shared = view([
      {
        kind: "folder",
        id: "social",
        fields: { label: "Social", icon: "messages", order: 0, hidden: false },
      },
      {
        kind: "bookmark",
        id: "drive",
        fields: {
          folder_id: "social",
          title: "Drive",
          url: "https://drive.google.com",
          order: 0,
          pinned: true,
        },
      },
      windowRecord("window:a"),
      layoutRecord("layout:a", "window:a", "pane:a"),
      {
        ...tabRecord("tab:a", "layout:a", "pane:a"),
        fields: {
          ...tabRecord("tab:a", "layout:a", "pane:a").fields,
          url: "https://drive.google.com/folders/current",
          bookmark_id: "drive",
        },
      },
    ]);
    const result = projectWorkspace(shared, local());
    expect(result.bookmarks[0].fields.url).toBe("https://drive.google.com");
    const state = dockLeaves(result.windows[0].layout.root)[0].views[0].state;
    expect(state).toMatchObject({
      url: "https://drive.google.com/folders/current",
      bookmarkId: "drive",
      profileId: "a".repeat(64),
    });
  });

  it("does not create random tabs or change IDs when importing empty geometry repeatedly", () => {
    const shared = view([windowRecord("window:a")]);
    expect(projectWorkspace(shared, local())).toEqual(projectWorkspace(shared, local()));
    expect(visibleTabIds(projectWorkspace(shared, local()))).toEqual([]);
  });
});

it("restores Space routes from another device without changing their pane", () => {
  const record = tabRecord("tab:space", "layout:a", "pane:a");
  record.fields = {
    ...record.fields,
    surface: "space",
    url: null,
    profile_id: null,
    tool_route: "/spaces/project/planner/tasks/list",
  };
  const result = projectWorkspace(
    view([windowRecord("window:a"), layoutRecord("layout:a", "window:a", "pane:a"), record]),
    local(),
  );
  const pane = dockLeaves(result.windows[0].layout.root)[0];
  expect(pane.id).toBe("pane:a");
  expect(pane.views[0]).toMatchObject({
    surfaceId: "space",
    route: "/spaces/project/planner/tasks/list",
    groupKey: "space:project:planner",
  });
});

it("opens a synced Files view from an older client as a new browser tab", () => {
  const record = tabRecord("tab:files", "layout:a", "pane:a");
  const { tool_route: _omitted, ...fields } = {
    ...record.fields,
    surface: "files" as const,
    url: null,
    profile_id: null,
  };
  // Records from older clients may omit tool_route entirely.
  record.fields = fields as typeof record.fields;
  const result = projectWorkspace(
    view([windowRecord("window:a"), layoutRecord("layout:a", "window:a", "pane:a"), record]),
    local(),
  );
  // Files moved to Kura, a separate app.
  expect(dockLeaves(result.windows[0].layout.root)[0].views[0]).toMatchObject({
    surfaceId: "browser",
    route: "/browser",
  });
});

describe("selection after a remote close", () => {
  const records = (layouts: string[]): SharedRecord[] => [
    windowRecord("window:a"),
    ...layouts.flatMap((id) => [
      layoutRecord(id, "window:a", `pane:${id}`),
      tabRecord(`tab:${id}`, id, `pane:${id}`),
    ]),
  ];
  const selection = (active: string): DeviceSelection => ({
    ...local(),
    activeWindowId: "window:a",
    activeTabByWindow: { "window:a": active },
    tabOrderByWindow: { "window:a": ["layout:a", "layout:b", "layout:c"] },
  });

  it("moves to the next layout, not the first, when the shown one closes elsewhere", () => {
    const projected = projectWorkspace(
      view(records(["layout:a", "layout:c"])),
      selection("layout:b"),
    );
    expect(projected.windows[0].layout.activeTabId).toBe("layout:c");
  });

  it("falls back to the previous layout when the last one closes elsewhere", () => {
    const projected = projectWorkspace(
      view(records(["layout:a", "layout:b"])),
      selection("layout:c"),
    );
    expect(projected.windows[0].layout.activeTabId).toBe("layout:b");
  });
});
