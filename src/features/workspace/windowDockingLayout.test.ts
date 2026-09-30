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
  const first = store.activeWindowId;
  store.setWindowDockingLayout(dockingPresets[2]);
  const second = store.createWindow("Research");
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
    store.closeWindow(second.id);
  });
  expect(useWorkspaceStore.getState().activeWindowId).toBe(first);
  expect(result.current).toEqual({ navigation: "bottom", tabs: "left" });
  act(() => {
    store.reopenClosedWindow();
  });
  expect(result.current).toEqual({ navigation: "right", tabs: "bottom" });
  const snapshot = store.createSnapshot("account", "device");
  act(() => {
    store.reset();
    store.replaceSnapshot(JSON.parse(JSON.stringify(snapshot)));
  });
  expect(result.current).toEqual({ navigation: "right", tabs: "bottom" });
});

it("accepts stacked edges without altering open panes and falls back for malformed saved values", () => {
  const store = useWorkspaceStore.getState();
  const panes = store.layout;
  store.setWindowDockingLayout(dockingPresets[2]);
  store.setWindowDockingLayout({ navigation: "bottom", tabs: "bottom" });
  expect(useWorkspaceStore.getState().layout).toBe(panes);
  const { result } = renderHook(useWindowDockingLayout);
  expect(result.current).toEqual({ navigation: "bottom", tabs: "bottom" });
  const state = useWorkspaceStore.getState();
  act(() =>
    useWorkspaceStore.setState({
      windowsByScope: {
        ...state.windowsByScope,
        global: state.windowsByScope.global!.map((window) => ({
          ...window,
          dockingLayout: {
            navigation: "center",
            tabs: "bottom",
          } as unknown as typeof defaultDockingLayout,
        })),
      },
    }),
  );
  expect(result.current).toEqual(defaultDockingLayout);
});

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
