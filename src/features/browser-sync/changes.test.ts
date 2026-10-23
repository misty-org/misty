import { describe, expect, it } from "vitest";
import { dockLeaves } from "@/features/workspace/dockTree";
import type { WorkspaceRecords } from "./model";
import { projectWorkspace } from "./projection";
import { workspaceChanges } from "./changes";

const profile = "a".repeat(64);
function fixture(orphan = false) {
  const view: WorkspaceRecords = {
    version: 1,
    sequence: 3,
    resumes: {},
    orphaned_view_ids: [],
    orphaned_bookmark_ids: [],
    records: [
      { kind: "window", id: "window:a", fields: { title: "Work", order: 0 } },
      {
        kind: "tab",
        id: "layout:a",
        fields: {
          window_id: "window:a",
          title: "",
          order: 0,
          tree: { type: "leaf", id: "pane:a" },
        },
      },
      {
        kind: "view",
        id: "tab:a",
        fields: {
          surface: "browser",
          title: "Page",
          placement: {
            tab_id: "layout:a",
            pane_id: orphan ? "pane:removed" : "pane:a",
            order: 0,
          },
          url: "https://example.test",
          profile_id: profile,
          bookmark_id: "website:launch",
          tool_route: null,
          agent_owned: false,
        },
      },
    ],
  };
  return projectWorkspace(view, {
    activeTabByWindow: {},
    activeViewByPane: {},
    focusedPaneByTab: {},
  }).windows;
}

describe("workspace edit field diff", () => {
  it("ignores focus, timestamps, favicon and pane history", () => {
    const before = fixture();
    const after = structuredClone(before);
    after[0].lastFocusedAt = 999;
    const pane = dockLeaves(after[0].layout.root)[0];
    pane.activeViewId = null;
    pane.views[0].lastFocusedAt = 123;
    (pane.views[0].state as Record<string, unknown>).faviconUrl = "https://other.test/icon";
    expect(workspaceChanges(before, after, profile).changes).toEqual([]);
  });

  it("writes just navigation fields, preserving saved launch identity and profile", () => {
    const before = fixture();
    const after = structuredClone(before);
    const tab = dockLeaves(after[0].layout.tabs![0].root)[0].views[0];
    tab.title = "Next";
    (tab.state as Record<string, unknown>).url = "https://example.test/next";
    expect(workspaceChanges(before, after, profile).changes).toEqual([
      {
        action: "patch",
        kind: "view",
        id: "tab:a",
        fields: { title: "Next", url: "https://example.test/next" },
      },
    ]);
  });

  it("never echoes an unchanged recovered tab or invents its shared container", () => {
    const before = fixture(true);
    const after = structuredClone(before);
    const recovered = after[0].layout.tabs!.find((layout) =>
      layout.id.startsWith("recovery:tab:"),
    )!;
    dockLeaves(recovered.root)[0].views[0].title = "Renamed orphan";
    expect(workspaceChanges(before, after, profile).changes).toEqual([
      { action: "patch", kind: "view", id: "tab:a", fields: { title: "Renamed orphan" } },
    ]);
  });

  it("materializes recovery geometry only after an explicit structural edit", () => {
    const before = fixture(true);
    const after = structuredClone(before);
    const recovered = after[0].layout.tabs!.find((layout) =>
      layout.id.startsWith("recovery:tab:"),
    )!;
    recovered.root = {
      type: "split",
      id: "split:new",
      direction: "horizontal",
      ratio: 0.5,
      first: recovered.root,
      second: { type: "leaf", id: "pane:new", views: [], activeViewId: null },
    };
    const result = workspaceChanges(before, after, profile, (kind) => `${kind}:materialized`);
    expect(result.changes).toContainEqual(
      expect.objectContaining({ action: "create", kind: "tab", id: "tab:materialized" }),
    );
    expect(result.changes).toContainEqual({
      action: "patch",
      kind: "view",
      id: "tab:a",
      fields: {
        placement: { tab_id: "tab:materialized", pane_id: "recovery:pane:tab:a", order: 0 },
      },
    });
    expect(result.changes.some((change) => change.id.startsWith("recovery:"))).toBe(false);
    expect(result.windows[0].layout.tabs!.some((layout) => layout.id === "tab:materialized")).toBe(
      true,
    );
  });

  it("records closed orphan views as deletions without deleting synthetic containers", () => {
    const before = fixture(true);
    const after = structuredClone(before);
    after[0].layout.tabs = after[0].layout.tabs!.filter(
      (layout) => !layout.id.startsWith("recovery:tab:"),
    );
    expect(workspaceChanges(before, after, profile).changes).toEqual([
      { action: "delete", kind: "view", id: "tab:a" },
    ]);
  });
});

it("opens a Home view synced by an older client as a new browser tab", () => {
  const encoded = workspaceChanges([], fixture(), profile).changes;
  const records = encoded.flatMap((change) =>
    change.action === "create" ? [{ kind: change.kind, id: change.id, fields: change.fields }] : [],
  );
  const view = records.find((record) => record.kind === "view")!;
  view.fields = {
    ...view.fields,
    surface: "home",
    url: null,
    tool_route: "/home",
  } as typeof view.fields;
  const projected = projectWorkspace(
    {
      version: 1,
      sequence: 1,
      records,
      resumes: {},
      orphaned_view_ids: [],
      orphaned_bookmark_ids: [],
    } as WorkspaceRecords,
    { activeTabByWindow: {}, activeViewByPane: {}, focusedPaneByTab: {} },
  );
  expect(
    projected.windows[0].layout.tabs!.flatMap((tab) =>
      dockLeaves(tab.root).flatMap((pane) => pane.views),
    ),
  ).toContainEqual(
    expect.objectContaining({ id: view.id, surfaceId: "browser", route: "/browser" }),
  );
});
