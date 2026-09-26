import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  defaultDockingLayout,
  dockingPresets,
  useDockingLayoutStore,
} from "@/features/app-shell/dockingLayout";
import { useWorkspaceStore } from "./useWorkspaceStore";
import { useWindowDockingLayout } from "./useWindowDockingLayout";
import { migrateWorkspaceStore, partialWorkspaceStore } from "./workspaceStorePersistence";

beforeEach(() => {
  useDockingLayoutStore.setState({ initialLayout: defaultDockingLayout, savedLayouts: [] });
  useWorkspaceStore.getState().reset();
});
afterEach(cleanup);

it("keeps window arrangements through persistence, scope changes, and reopening", () => {
  const store = useWorkspaceStore.getState();
  const first = store.activeVirtualWindowId;
  store.setWindowDockingLayout(dockingPresets[2]);
  const second = store.createVirtualWindow("Research");
  store.setWindowDockingLayout(dockingPresets[3]);
  const saved = JSON.parse(JSON.stringify(partialWorkspaceStore(useWorkspaceStore.getState())));
  store.reset();
  useWorkspaceStore.setState(migrateWorkspaceStore(saved, 14));
  const { result } = renderHook(useWindowDockingLayout);
  expect(result.current).toEqual({ navigation: "right", tabs: "bottom" });
  act(() => {
    store.setScope("space:other");
  });
  expect(result.current).toEqual(defaultDockingLayout);
  act(() => {
    store.setWindowDockingLayout(dockingPresets[1]);
    store.setScope("global");
  });
  expect(result.current).toEqual({ navigation: "right", tabs: "bottom" });
  act(() => {
    store.closeVirtualWindow(second.id);
  });
  expect(useWorkspaceStore.getState().activeVirtualWindowId).toBe(first);
  expect(result.current).toEqual({ navigation: "bottom", tabs: "left" });
  act(() => {
    store.reopenClosedVirtualWindow();
  });
  expect(result.current).toEqual({ navigation: "right", tabs: "bottom" });
  const snapshot = store.createSnapshot("account", "device");
  act(() => {
    store.reset();
    store.replaceSnapshot(JSON.parse(JSON.stringify(snapshot)));
  });
  expect(result.current).toEqual({ navigation: "right", tabs: "bottom" });
});

it("rejects occupied edges without altering open panes and falls back for malformed saved values", () => {
  const store = useWorkspaceStore.getState();
  const panes = store.layout;
  store.setWindowDockingLayout(dockingPresets[2]);
  store.setWindowDockingLayout({ navigation: "bottom", tabs: "bottom" });
  expect(useWorkspaceStore.getState().layout).toBe(panes);
  const { result } = renderHook(useWindowDockingLayout);
  expect(result.current).toEqual({ navigation: "bottom", tabs: "left" });
  const state = useWorkspaceStore.getState();
  act(() =>
    useWorkspaceStore.setState({
      virtualWindowsByScope: {
        ...state.virtualWindowsByScope,
        global: state.virtualWindowsByScope.global!.map((window) => ({
          ...window,
          dockingLayout: { navigation: "bottom", tabs: "bottom" },
        })),
      },
    }),
  );
  expect(result.current).toEqual(defaultDockingLayout);
});
