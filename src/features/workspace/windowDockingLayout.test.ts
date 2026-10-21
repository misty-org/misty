import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { defaultDockingLayout, useDockingLayoutStore } from "@/features/app-shell/dockingLayout";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { useWindowDockingLayout } from "./useWindowDockingLayout";

beforeEach(() => {
  useDockingLayoutStore.setState({ initialLayout: defaultDockingLayout, savedLayouts: [] });
  useWorkspaceStore.getState().reset();
});
afterEach(cleanup);

it.each(["left", "right"] as const)("preserves the %s tab side in workspace snapshots", (side) => {
  const store = useWorkspaceStore.getState();
  store.setWindowDockingLayout({ navigation: side === "left" ? "right" : "left", tabs: side });
  const snapshot = store.createSnapshot("account", "device");
  store.reset();
  store.replaceSnapshot(JSON.parse(JSON.stringify(snapshot)));
  const { result } = renderHook(useWindowDockingLayout);
  expect(result.current.tabs).toBe(side);
});

it.each(["top", "bottom"])("moves tabs saved on the %s edge into the left sidebar", (edge) => {
  useWorkspaceStore.setState({ dockingLayout: { navigation: "left", tabs: edge } as never });
  const { result } = renderHook(useWindowDockingLayout);
  expect(result.current).toEqual({ tabs: "left", navigation: "right" });
});
