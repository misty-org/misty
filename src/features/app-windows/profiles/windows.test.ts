import { beforeEach, describe, expect, it } from "vitest";
import { createDockLeaf, dockLeaves, findDockLeaf, insertDockSplit } from "../panes/dockTree";
import { useWorkspaceStore } from "../tabs/useWorkspaceStore";
import { currentWindows } from "./windows";
import { currentWindowId } from "./profileWindow";
import { followSpaceWindow, spaceWindow } from "../tabs/spaceWindow";
import { parseWorkspaceRecord } from "../tabs/workspaceRecord";
import { migrateWorkspaceStore, partialWorkspaceStore } from "../tabs/workspaceStorePersistence";
import { allLayoutViews } from "../panes/layoutTabs";
import { openPage } from "@/tests/workspacePage";
import { browserWorkspaceStoreVersion } from "../recovery/workspaceRecoveryStorage";

const record = (state: unknown) => JSON.stringify({ version: browserWorkspaceStoreVersion, state });

describe("a window of one profile", () => {
  beforeEach(() => {
    useWorkspaceStore.persist.clearStorage();
    useWorkspaceStore.getState().reset();
  });

  it("holds exactly one window, under the native window's id", () => {
    const state = useWorkspaceStore.getState();
    expect(state.activeWindowId).toBe(currentWindowId());
    expect(currentWindows(state)).toHaveLength(1);
    expect(currentWindows(state)[0].id).toBe(state.activeWindowId);
  });

  it("keeps the window's identity through a save and restore", () => {
    const id = useWorkspaceStore.getState().activeWindowId;
    const tab = openPage(useWorkspaceStore.getState(), { url: "https://example.com" });
    const saved = record(partialWorkspaceStore(useWorkspaceStore.getState()));
    useWorkspaceStore.getState().reset();
    useWorkspaceStore.setState(parseWorkspaceRecord(saved));
    expect(useWorkspaceStore.getState().activeWindowId).toBe(id);
    expect(allLayoutViews(useWorkspaceStore.getState().layout).map((view) => view.id)).toContain(
      tab.id,
    );
  });

  it("caps the window at a two by two grid", () => {
    const first = useWorkspaceStore.getState().layout.focusedPaneId;
    const second = useWorkspaceStore.getState().splitPane(first, "right")!;
    // A third pane beside the pair would be a row of three, which a window never has.
    expect(useWorkspaceStore.getState().splitPane(second, "right")).toBeNull();
    useWorkspaceStore.getState().splitPane(first, "down")!;
    const fourth = useWorkspaceStore.getState().splitPane(second, "down")!;
    expect(dockLeaves(useWorkspaceStore.getState().layout.root)).toHaveLength(4);
    expect(useWorkspaceStore.getState().splitPane(fourth, "down")).toBeNull();
  });

  it("loads an oversized saved layout as four panes", () => {
    const createTestTab = (id: string) => ({
      id,
      surfaceId: "agents" as const,
      groupKey: "tool:agents" as const,
      instanceKey: "agents",
      title: "Agents",
      route: "/agents",
      sidebarVisible: false,
      state: {},
      createdAt: 1,
      lastFocusedAt: 1,
    });
    const first = createDockLeaf([createTestTab("tab-0")]);
    let root = first as ReturnType<typeof insertDockSplit>;
    let target = first.id;
    for (let index = 0; index < 4; index += 1) {
      const leaf = createDockLeaf([createTestTab(`tab-${index + 1}`)]);
      root = insertDockSplit(root, target, leaf, "right");
      target = leaf.id;
    }
    useWorkspaceStore.setState(
      parseWorkspaceRecord(
        record({ layout: { root, focusedPaneId: target }, lastUsedViewByGroup: {} }),
      ),
    );

    expect(dockLeaves(useWorkspaceStore.getState().layout.root)).toHaveLength(4);
  });

  it("swaps pane views without changing the tab layout", () => {
    const files = useWorkspaceStore.getState().openSurface({
      surfaceId: "agents",
      groupKey: "tool:agents",
      title: "Files",
      route: "/agents",
      forceNew: true,
    });
    const first = useWorkspaceStore.getState().layout.focusedPaneId;
    const second = useWorkspaceStore.getState().splitPane(first, "right")!;
    const terminal = useWorkspaceStore.getState().openSurface({
      surfaceId: "agents",
      groupKey: "tool:agents",
      title: "Terminal",
      route: "/terminal",
      forceNew: true,
      paneId: second,
    });

    expect(useWorkspaceStore.getState().swapPanes(first, second)).toBe(true);
    expect(findDockLeaf(useWorkspaceStore.getState().layout.root, first)?.activeViewId).toBe(
      terminal.id,
    );
    expect(findDockLeaf(useWorkspaceStore.getState().layout.root, second)?.activeViewId).toBe(
      files.id,
    );
  });
});

describe("switching a window's Space", () => {
  const workKey = "space_01951d32-40ac-7000-8000-000000000001";
  beforeEach(() => {
    followSpaceWindow("personal");
    useWorkspaceStore.persist.clearStorage();
    useWorkspaceStore.getState().reset();
  });

  it("never touches tabs", () => {
    const tab = openPage(useWorkspaceStore.getState(), { url: "https://personal.example" });
    const before = useWorkspaceStore.getState().layout;
    const windowId = useWorkspaceStore.getState().activeWindowId;
    followSpaceWindow(workKey);
    expect(spaceWindow()).toMatchObject({ key: workKey, spaceId: workKey, personal: false });
    expect(useWorkspaceStore.getState().layout).toBe(before);
    expect(useWorkspaceStore.getState().activeWindowId).toBe(windowId);
    followSpaceWindow("personal");
    expect(useWorkspaceStore.getState().layout).toBe(before);
    expect(allLayoutViews(before).map((view) => view.id)).toContain(tab.id);
  });

  it("saves one layout, with nothing per Space", () => {
    const tab = openPage(useWorkspaceStore.getState(), { url: "https://personal.example" });
    const saved = JSON.parse(JSON.stringify(partialWorkspaceStore(useWorkspaceStore.getState())));
    expect("layoutsByScope" in saved).toBe(false);
    const restored = migrateWorkspaceStore(saved, browserWorkspaceStoreVersion);
    expect(allLayoutViews(restored.layout).map((view) => view.id)).toContain(tab.id);
  });
});
