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

it.each(["left", "top", "right", "bottom"] as const)(
  "preserves stacked %s bars in workspace snapshots",
  (edge) => {
    const store = useWorkspaceStore.getState();
    store.setWindowDockingLayout({ navigation: edge, tabs: edge });
    const snapshot = store.createSnapshot("account", "device");
    store.reset();
    store.replaceSnapshot(JSON.parse(JSON.stringify(snapshot)));
    const { result } = renderHook(useWindowDockingLayout);
    expect(result.current).toEqual({ navigation: edge, tabs: edge });
  },
);
