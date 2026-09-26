import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ state: {} as any, registrations: {} as any }));
vi.mock("@/features/workspace/useWorkspaceStore", () => ({
  useWorkspaceStore: { getState: () => fixture.state },
}));
vi.mock("@/features/workspace/virtualWindows", () => ({
  currentVirtualWindows: () => fixture.state.windows,
}));
vi.mock("@/features/ai-surface/store", () => ({
  useAiSurfaceStore: { getState: () => ({ registrations: fixture.registrations }) },
}));
import { resolveMistyContext, contextOptions } from "./context";
const pane = (id: string) => ({
  id,
  type: "leaf",
  tabs: [{ id: `view-${id}`, title: id }],
  activeTabId: `view-${id}`,
  history: [{ id: "private-history" }],
});
beforeEach(() => {
  fixture.state = {
    activeScopeKey: "global",
    activeVirtualWindowId: "w",
    layout: { focusedPaneId: "p" },
    windows: [
      {
        id: "w",
        title: "Window",
        layout: { tabs: [{ id: "t", title: "Research", root: pane("p"), focusedPaneId: "p" }] },
      },
    ],
  };
  fixture.registrations = {
    "a:p": {
      accountId: "a",
      paneId: "p",
      adapter: {
        getContext: () => [
          { id: "doc", kind: "note", privacy: "private", spaceId: "", title: "Draft" },
        ],
        getSelection: () => ({
          kind: "text",
          content: "selected",
          object: { kind: "note", id: "doc" },
          contentHash: "v1",
        }),
      },
    },
  };
});
describe("Misty workspace context", () => {
  it("uses the focused pane by default and freezes selections", () => {
    const snapshot = resolveMistyContext("a", "");
    expect(snapshot.context[0].id).toBe("doc");
    expect(snapshot.selection?.content).toBe("selected");
    fixture.registrations["a:p"].adapter.getContext = () => [];
    expect(snapshot.context).toHaveLength(1);
  });
  it("follows a renamed container and includes newly added live panes, never history", () => {
    const target = { kind: "tab" as const, spaceId: "", windowId: "w", tabId: "t" };
    const tab = fixture.state.windows[0].layout.tabs[0];
    tab.title = "Renamed";
    tab.root = {
      type: "split",
      id: "split",
      first: pane("p"),
      second: pane("q"),
      direction: "horizontal",
      ratio: 0.5,
    };
    const snapshot = resolveMistyContext("a", "", [target]);
    expect(snapshot.context[0].kind).toBe("workspace.scope");
    expect(
      (JSON.parse(String(snapshot.context[0].metadata?.members)) as Array<{ id: string }>).map(
        (ref) => ref.id,
      ),
    ).toEqual(["doc", "view-q"]);
    expect(contextOptions("").some((option) => option.label.includes("Renamed"))).toBe(true);
  });
  it("follows a moved pane by stable ID instead of its old parents", () => {
    const snapshot = resolveMistyContext("a", "", [
      { kind: "pane", spaceId: "", windowId: "old-window", tabId: "old-tab", paneId: "p" },
    ]);
    expect(snapshot.context[0].id).toBe("doc");
  });
  it("marks closed targets unavailable instead of substituting the focused pane", () => {
    expect(() =>
      resolveMistyContext("a", "", [{ kind: "pane", spaceId: "", paneId: "missing" }]),
    ).toThrow(/closed/);
  });
  it("ignores legacy Space bindings and never uses another account's adapter", () => {
    expect(
      resolveMistyContext("a", "", [{ kind: "workspace", spaceId: "other" }]).context[0].kind,
    ).toBe("workspace.scope");
    expect(resolveMistyContext("b", "").context[0].id).toBe("view-p");
  });
  it("collects the open workspace as one scoped attachment", () => {
    const snapshot = resolveMistyContext("a", "", [{ kind: "workspace", spaceId: "" }]);
    expect(snapshot.context.map((ref) => ref.kind)).toEqual(["workspace.scope"]);
    expect(snapshot.selection).toBeUndefined();
  });
});

it("keeps browser context available to historical conversations", () => {
  expect(contextOptions("old-space")).toEqual(contextOptions(""));
  expect(resolveMistyContext("a", "old-space")).toEqual(resolveMistyContext("a", ""));
  expect(
    resolveMistyContext("a", "old-space", [{ kind: "workspace", spaceId: "old-space" }]).context[0]
      .kind,
  ).toBe("workspace.scope");
});
