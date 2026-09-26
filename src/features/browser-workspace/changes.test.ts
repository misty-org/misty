import { describe, expect, it } from "vitest";
import { dockLeaves } from "@/features/workspace/dockTree";
import type { WorkspaceView } from "./model";
import { projectWorkspace } from "./projection";
import { workspaceChanges } from "./changes";

const profile = "a".repeat(64);
function fixture(orphan = false) {
  const view: WorkspaceView = {
    version: 1,
    sequence: 3,
    resumes: {},
    orphaned_tab_ids: [],
    orphaned_website_ids: [],
    records: [
      { kind: "window", id: "window:a", fields: { title: "Work", order: 0 } },
      {
        kind: "layout",
        id: "layout:a",
        fields: {
          window_id: "window:a",
          title: "",
          order: 0,
          tree: { type: "leaf", id: "pane:a" },
        },
      },
      {
        kind: "tab",
        id: "tab:a",
        fields: {
          surface: "browser",
          title: "Page",
          placement: {
            layout_id: "layout:a",
            pane_id: orphan ? "pane:removed" : "pane:a",
            order: 0,
          },
          url: "https://example.test",
          profile_id: profile,
          website_id: "website:launch",
          tool_route: null,
          agent_owned: false,
        },
      },
    ],
  };
  return projectWorkspace(view, {
    activeLayoutByWindow: {},
    activeTabByPane: {},
    focusedPaneByLayout: {},
  }).windows;
}

describe("workspace edit field diff", () => {
  it("ignores focus, timestamps, favicon and pane history", () => {
    const before = fixture();
    const after = structuredClone(before);
    after[0].lastFocusedAt = 999;
    const pane = dockLeaves(after[0].layout.root)[0];
    pane.activeTabId = null;
    pane.tabs[0].lastFocusedAt = 123;
    (pane.tabs[0].state as Record<string, unknown>).faviconUrl = "https://other.test/icon";
    expect(workspaceChanges(before, after, profile).changes).toEqual([]);
  });

  it("writes just navigation fields, preserving saved launch identity and profile", () => {
    const before = fixture();
    const after = structuredClone(before);
    const tab = dockLeaves(after[0].layout.tabs![0].root)[0].tabs[0];
    tab.title = "Next";
    (tab.state as Record<string, unknown>).url = "https://example.test/next";
    expect(workspaceChanges(before, after, profile).changes).toEqual([
      {
        action: "patch",
        kind: "tab",
        id: "tab:a",
        fields: { title: "Next", url: "https://example.test/next" },
      },
    ]);
  });

  it("never echoes an unchanged recovered tab or invents its shared container", () => {
    const before = fixture(true);
    const after = structuredClone(before);
    const recovered = after[0].layout.tabs!.find((layout) =>
      layout.id.startsWith("recovery:layout:"),
    )!;
    dockLeaves(recovered.root)[0].tabs[0].title = "Renamed orphan";
    expect(workspaceChanges(before, after, profile).changes).toEqual([
      { action: "patch", kind: "tab", id: "tab:a", fields: { title: "Renamed orphan" } },
    ]);
  });

  it("materializes recovery geometry only after an explicit structural edit", () => {
    const before = fixture(true);
    const after = structuredClone(before);
    const recovered = after[0].layout.tabs!.find((layout) =>
      layout.id.startsWith("recovery:layout:"),
    )!;
    recovered.root = {
      type: "split",
      id: "split:new",
      direction: "horizontal",
      ratio: 0.5,
      first: recovered.root,
      second: { type: "leaf", id: "pane:new", tabs: [], activeTabId: null },
    };
    const result = workspaceChanges(before, after, profile, (kind) => `${kind}:materialized`);
    expect(result.changes).toContainEqual(
      expect.objectContaining({ action: "create", kind: "layout", id: "layout:materialized" }),
    );
    expect(result.changes).toContainEqual({
      action: "patch",
      kind: "tab",
      id: "tab:a",
      fields: {
        placement: { layout_id: "layout:materialized", pane_id: "recovery:pane:tab:a", order: 0 },
      },
    });
    expect(result.changes.some((change) => change.id.startsWith("recovery:"))).toBe(false);
    expect(
      result.windows[0].layout.tabs!.some((layout) => layout.id === "layout:materialized"),
    ).toBe(true);
  });

  it("records closed orphan views as deletions without deleting synthetic containers", () => {
    const before = fixture(true);
    const after = structuredClone(before);
    after[0].layout.tabs = after[0].layout.tabs!.filter(
      (layout) => !layout.id.startsWith("recovery:layout:"),
    );
    expect(workspaceChanges(before, after, profile).changes).toEqual([
      { action: "delete", kind: "tab", id: "tab:a" },
    ]);
  });
});
