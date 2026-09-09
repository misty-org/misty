import { expect, it } from "vitest";
import { reconcileGroupIdentities } from "./groupIdentity";
import { createDockLeaf, dockLeaves } from "./dockTree";
import type { WorkspaceLayout, WorkspaceTab } from "./model";
const tab = (id: string) =>
  ({
    id,
    groupKey: "app:chat",
    title: id,
    surfaceId: "official-app",
    instanceKey: id,
    route: "/apps/chat",
    sidebarVisible: true,
    state: null,
    createdAt: 1,
    lastFocusedAt: 1,
  }) as WorkspaceTab;
const layout = (a: WorkspaceTab[], b: WorkspaceTab[] = []): WorkspaceLayout => ({
  focusedPaneId: "a",
  root: {
    type: "split",
    id: "split",
    direction: "horizontal",
    ratio: 0.5,
    first: { ...createDockLeaf(a), id: "a" },
    second: { ...createDockLeaf(b), id: "b" },
  },
});
const panes = (value: WorkspaceLayout) => dockLeaves(value.root);
it("migration creates stable shared group identities without converting titles to aliases", () => {
  const a = reconcileGroupIdentities(layout([tab("one"), tab("two")]));
  const b = reconcileGroupIdentities(layout([tab("one"), tab("two")]));
  expect(panes(a)[0].tabs[0].groupInstanceId).toBe(panes(b)[0].tabs[1].groupInstanceId);
  expect(panes(a)[0].tabs.map((t) => t.title)).toEqual(["one", "two"]);
});
it("full moves retain identity, partial moves split, and merges use destination identity", () => {
  const initial = reconcileGroupIdentities(layout([tab("one"), tab("two")]));
  const [one, two] = panes(initial)[0].tabs;
  const moved = reconcileGroupIdentities(layout([], [one, two]), initial);
  expect(panes(moved)[1].tabs[0].groupInstanceId).toBe(one.groupInstanceId);
  const split = reconcileGroupIdentities(layout([one], [two]), initial);
  const splitId = panes(split)[1].tabs[0].groupInstanceId;
  expect(splitId).not.toBe(one.groupInstanceId);
  const merged = reconcileGroupIdentities(layout([], [one, panes(split)[1].tabs[0]]), split);
  expect(panes(merged)[1].tabs.every((t) => t.groupInstanceId === splitId)).toBe(true);
});
