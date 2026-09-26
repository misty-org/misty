import { describe, expect, it } from "vitest";
import { dockLeaves } from "@/features/workspace/dockTree";
import type { DeviceSelection, SharedRecord, WorkspaceView } from "./model";
import { projectWorkspace, recoveryLayoutId } from "./projection";

const local = (): DeviceSelection => ({
  activeLayoutByWindow: {},
  activeTabByPane: {},
  focusedPaneByLayout: {},
});
const view = (records: SharedRecord[]): WorkspaceView => ({
  version: 1,
  sequence: 3,
  records,
  resumes: {},
  orphaned_tab_ids: [],
  orphaned_website_ids: [],
});
const windowRecord = (id: string, order = 0): SharedRecord<"window"> => ({
  kind: "window",
  id,
  fields: { title: id, order },
});
const layoutRecord = (id: string, window: string, pane: string): SharedRecord<"layout"> => ({
  kind: "layout",
  id,
  fields: { window_id: window, title: "", order: 0, tree: { type: "leaf", id: pane } },
});
const tabRecord = (id: string, layout: string, pane: string): SharedRecord<"tab"> => ({
  kind: "tab",
  id,
  fields: {
    surface: "browser",
    title: id,
    placement: { layout_id: layout, pane_id: pane, order: 0 },
    url: `https://example.test/${id}`,
    profile_id: "a".repeat(64),
    website_id: null,
    tool_route: null,
    agent_owned: false,
  },
});

function visibleTabIds(projected: ReturnType<typeof projectWorkspace>) {
  return projected.windows
    .flatMap((window) =>
      window.layout.tabs!.flatMap((layout) =>
        dockLeaves(layout.root).flatMap((pane) => pane.tabs.map((tab) => tab.id)),
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
        active_layout_id: "layout:a",
        focused_pane_id: "pane:a",
        active_tab_by_pane: { "pane:a": "tab:a" },
      },
    };
    const selected = {
      ...local(),
      activeWindowId: "window:b",
      activeLayoutByWindow: { "window:b": "layout:b" },
    };
    expect(projectWorkspace(shared, selected).activeWindowId).toBe("window:b");
    expect(projectWorkspace(shared, selected).windows[1].layout.activeLayoutTabId).toBe("layout:b");
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
      activeTabByPane: { "pane:kept": "tab:three" },
    });
    expect(visibleTabIds(result)).toEqual(["tab:one", "tab:three", "tab:two"]);
    expect(result.windows[0].layout.tabs!.map((tab) => tab.id)).toContain(
      recoveryLayoutId("tab:two"),
    );
    expect(result.recoveryTabIds).toEqual(["tab:one", "tab:two"]);
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
        kind: "group",
        id: "social",
        fields: { label: "Social", icon: "messages", order: 0, hidden: false },
      },
      {
        kind: "website",
        id: "drive",
        fields: {
          group_id: "social",
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
          website_id: "drive",
        },
      },
    ]);
    const result = projectWorkspace(shared, local());
    expect(result.websites[0].fields.url).toBe("https://drive.google.com");
    const state = dockLeaves(result.windows[0].layout.root)[0].tabs[0].state;
    expect(state).toMatchObject({
      url: "https://drive.google.com/folders/current",
      websiteId: "drive",
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
  expect(pane.tabs[0]).toMatchObject({
    surfaceId: "space",
    route: "/spaces/project/planner/tasks/list",
    groupKey: "space:project:planner",
  });
});
