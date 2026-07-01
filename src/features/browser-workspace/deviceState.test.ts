import { describe, expect, it } from "vitest";
import { dockLeaves } from "@/features/workspace/dockTree";
import {
  createBrowserTabState,
  type WorkspaceTab,
  type WorkspaceVirtualWindow,
} from "@/features/workspace/model";
import { retainDeviceState } from "./deviceState";
function fixture(surface: "browser" | "files" = "browser"): WorkspaceVirtualWindow[] {
  const tab: WorkspaceTab = {
    id: "tab:a",
    instanceKey: "tab:a",
    surfaceId: surface,
    groupKey: `tool:${surface}`,
    route: `/${surface}`,
    title: "Page",
    sidebarVisible: false,
    state:
      surface === "browser"
        ? { ...createBrowserTabState("https://example.test"), profileId: "a".repeat(64) }
        : null,
    createdAt: 0,
    lastFocusedAt: 0,
  };
  const root = { type: "leaf" as const, id: "pane:a", tabs: [tab], activeTabId: tab.id };
  const layout = { id: "layout:a", root, focusedPaneId: root.id };
  return [
    {
      id: "window:a",
      title: "Work",
      createdAt: 0,
      lastFocusedAt: 0,
      layout: { ...layout, tabs: [layout], activeLayoutTabId: layout.id },
    },
  ];
}
const view = (windows: WorkspaceVirtualWindow[]) => dockLeaves(windows[0].layout.root)[0].tabs[0];
describe("device state retention during shared projection", () => {
  it("retains local view history, timestamps and favicon without mutating shared inputs", () => {
    const previous = fixture(),
      incoming = fixture();
    const old = view(previous);
    old.createdAt = 100;
    old.lastFocusedAt = 200;
    old.sidebarVisible = true;
    old.state = { ...(old.state as object), faviconUrl: "https://example.test/custom.ico" };
    previous[0].createdAt = 50;
    const pane = dockLeaves(previous[0].layout.root)[0];
    pane.history = { entries: [{ ...old, title: "Before" }, old], index: 1 };
    view(incoming).title = "Remote title";
    const result = retainDeviceState(incoming, previous);
    expect(view(result)).toMatchObject({
      title: "Remote title",
      createdAt: 100,
      lastFocusedAt: 200,
      sidebarVisible: true,
      state: { faviconUrl: "https://example.test/custom.ico" },
    });
    expect(result[0].createdAt).toBe(50);
    expect(
      dockLeaves(result[0].layout.root)[0].history?.entries.map((entry) => entry.title),
    ).toEqual(["Before", "Remote title"]);
    expect(result[0].layout.root).toBe(result[0].layout.tabs![0].root);
    expect(view(incoming).createdAt).toBe(0);
    expect(old.title).toBe("Page");
  });
  it("imports changed navigation and profile without carrying over stale favicon data", () => {
    const previous = fixture(),
      incoming = fixture();
    view(previous).state = {
      ...(view(previous).state as object),
      faviconUrl: "https://example.test/private.ico",
    };
    view(incoming).state = {
      ...createBrowserTabState("https://next.test"),
      profileId: "b".repeat(64),
      websiteId: "website:new",
    };
    expect(view(retainDeviceState(incoming, previous)).state).toEqual(view(incoming).state);
  });
  it("retains Files paths only for an existing Files view on this device", () => {
    const previous = fixture("files"),
      incoming = fixture("files");
    view(previous).state = { selectedPath: "/Users/alice/Documents" };
    expect(view(retainDeviceState(incoming, previous)).state).toEqual(view(previous).state);
    view(incoming).id = "tab:other-device";
    expect(view(retainDeviceState(incoming, previous)).state).toBeNull();
    view(incoming).id = "tab:a";
    view(incoming).surfaceId = "browser";
    expect(view(retainDeviceState(incoming, previous)).state).toBeNull();
  });
  it("drops pane history when a different shared view occupies the pane", () => {
    const previous = fixture(),
      incoming = fixture();
    dockLeaves(previous[0].layout.root)[0].history = { entries: [view(previous)], index: 0 };
    const pane = dockLeaves(incoming[0].layout.root)[0];
    pane.tabs[0].id = "tab:new";
    pane.activeTabId = "tab:new";
    expect(
      dockLeaves(retainDeviceState(incoming, previous)[0].layout.root)[0].history,
    ).toBeUndefined();
  });
});
