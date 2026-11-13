import { beforeEach, describe, expect, it } from "vitest";
import { adoptWindowTabs } from "./adoptWindowTabs";
import { allLayoutViews, singleViewTab } from "../panes/layoutTabs";
import type { WorkspaceLayout, WorkspaceTab, WorkspaceView } from "./workspaceViews";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { openPage } from "@/tests/workspacePage";

const view = (id: string, placeholder = false): WorkspaceView => ({
  id,
  surfaceId: "agents",
  groupKey: "tool:agents",
  instanceKey: id,
  title: id,
  route: "/agents",
  sidebarVisible: false,
  state: {},
  createdAt: 1,
  lastFocusedAt: 1,
  placeholder,
});
const layoutOf = (tabs: WorkspaceTab[], activeTabId = tabs[0].id): WorkspaceLayout => ({
  root: tabs[0].root,
  focusedPaneId: tabs[0].focusedPaneId,
  tabs,
  activeTabId,
});
const ids = (layout: WorkspaceLayout) => allLayoutViews(layout).map((item) => item.id);
const state = () => useWorkspaceStore.getState();

describe("adopting a closed window's tabs", () => {
  beforeEach(() => state().reset());

  it("replaces a window showing only its first empty tab, and keeps the closed window's place", () => {
    const tabs = [singleViewTab(view("a")), singleViewTab(view("b"))];
    const patch = adoptWindowTabs(state(), { layout: layoutOf(tabs, tabs[1].id) });
    expect(ids(patch.layout!)).toEqual(["a", "b"]);
    expect(patch.layout!.activeTabId).toBe(tabs[1].id);
  });

  it("adds to the end of a window in use and keeps the tab on screen, asleep", () => {
    const mine = openPage(state(), { url: "https://mine.test" });
    const active = state().layout.activeTabId;
    const patch = adoptWindowTabs(state(), { layout: layoutOf([singleViewTab(view("late"))]) });
    expect(patch.layout!.activeTabId).toBe(active);
    expect(ids(patch.layout!)).toContain(mine.id);
    expect(ids(patch.layout!).slice(-1)).toEqual(["late"]);
  });

  it("drops a closed window's unused new tabs", () => {
    const mine = openPage(state(), { url: "https://mine.test" });
    const patch = adoptWindowTabs(state(), {
      layout: layoutOf([singleViewTab(view("blank", true))]),
    });
    expect(patch.layout).toBeUndefined();
    expect(ids(state().layout)).toContain(mine.id);
  });

  it("doesn't take a tab it already holds", () => {
    const mine = openPage(state(), { url: "https://mine.test" });
    const patch = adoptWindowTabs(state(), { layout: state().layout });
    expect(patch.layout).toBeUndefined();
    expect(ids(state().layout)).toContain(mine.id);
  });

  it("keeps the closed window's reopenable tabs", () => {
    const closedItem = {
      view: view("gone"),
      paneId: "pane",
      windowId: "w",
      closedAt: 1,
    } as unknown as WorkspaceStoreClosedItem;
    const patch = adoptWindowTabs(state(), { closedItems: [closedItem] });
    expect(patch.closedItems).toEqual([closedItem]);
  });
});

type WorkspaceStoreClosedItem = ReturnType<typeof state>["closedItems"][number];
