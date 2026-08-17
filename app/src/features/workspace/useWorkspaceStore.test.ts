import { beforeEach, describe, expect, it } from "vitest";
import { parseBrowserTabState, workspaceMaxPanes } from "./model";
import { useWorkspaceStore } from "./useWorkspaceStore";

const browserRequest = {
  surfaceId: "browser" as const,
  groupKey: "tool:browser" as const,
  title: "Browser",
  route: "/browser",
  instancePolicy: "multiple" as const,
};

describe("desktop workspace store", () => {
  beforeEach(() => {
    useWorkspaceStore.persist.clearStorage();
    useWorkspaceStore.getState().reset();
  });

  it("focuses the last-used group instance unless a duplicate is requested", () => {
    const first = useWorkspaceStore.getState().openSurface(browserRequest);
    const same = useWorkspaceStore.getState().openSurface(browserRequest);
    const duplicate = useWorkspaceStore
      .getState()
      .openSurface({ ...browserRequest, forceNew: true });

    expect(same.id).toBe(first.id);
    expect(duplicate.id).not.toBe(first.id);
    expect(useWorkspaceStore.getState().lastUsedTabByGroup["tool:browser"]).toBe(duplicate.id);
  });

  it("syncs route-driven navigation into an existing Space tab", () => {
    const request = {
      surfaceId: "space" as const,
      groupKey: "space:space-1" as const,
      instanceKey: "space-1",
      title: "Space",
      route: "/spaces/space-1",
      instancePolicy: "multiple" as const,
      syncExistingRoute: true,
    };
    const first = useWorkspaceStore.getState().openSurface(request);
    const redirected = useWorkspaceStore.getState().openSurface({
      ...request,
      route: "/spaces/space-1/notes",
    });

    expect(redirected.id).toBe(first.id);
    expect(redirected.route).toBe("/spaces/space-1/notes");
    expect(useWorkspaceStore.getState().layout.panes[0]?.tabs).toHaveLength(1);
  });

  it("keeps singleton surfaces single-instance", () => {
    const request = {
      surfaceId: "agents" as const,
      groupKey: "tool:agents" as const,
      title: "Agents",
      route: "/agents",
      instancePolicy: "single" as const,
    };
    const first = useWorkspaceStore.getState().openSurface(request);
    const second = useWorkspaceStore.getState().openSurface({ ...request, forceNew: true });
    expect(second.id).toBe(first.id);
    const third = useWorkspaceStore.getState().openSurface(request);
    expect(third.id).toBe(first.id);
  });

  it("limits a layout to four panes", () => {
    const paneId = useWorkspaceStore.getState().layout.panes[0]!.id;
    for (let index = 1; index < workspaceMaxPanes; index += 1) {
      expect(useWorkspaceStore.getState().splitPane(paneId, "right")).toBeTruthy();
    }
    expect(useWorkspaceStore.getState().layout.panes).toHaveLength(workspaceMaxPanes);
    expect(useWorkspaceStore.getState().splitPane(paneId, "right")).toBeNull();
  });

  it("preserves and restores a maximized layout", () => {
    const paneId = useWorkspaceStore.getState().layout.panes[0]!.id;
    useWorkspaceStore.getState().splitPane(paneId, "right");
    useWorkspaceStore.getState().toggleMaximize(paneId);
    expect(useWorkspaceStore.getState().layout.maximizedPaneId).toBe(paneId);
    expect(useWorkspaceStore.getState().layout.preservedPreset).toBe("columns");
    useWorkspaceStore.getState().restoreLayout();
    expect(useWorkspaceStore.getState().layout.maximizedPaneId).toBeNull();
    expect(useWorkspaceStore.getState().layout.preset).toBe("columns");
  });

  it("remembers sidebar visibility per tab in persisted snapshots", () => {
    const tab = useWorkspaceStore.getState().openSurface(browserRequest);
    useWorkspaceStore.getState().toggleSidebar(tab.id);
    const snapshot = useWorkspaceStore.getState().createSnapshot("account-1", "device-1");
    expect(snapshot.layout.panes[0]?.tabs[0]?.sidebarVisible).toBe(false);
    useWorkspaceStore.getState().reset();
    useWorkspaceStore.getState().replaceSnapshot(snapshot);
    expect(useWorkspaceStore.getState().layout.panes[0]?.tabs[0]?.sidebarVisible).toBe(false);
  });

  it("opens browser pages as adjacent workspace tabs", () => {
    const first = useWorkspaceStore.getState().openBrowserTab({ url: "https://example.com" });
    const second = useWorkspaceStore.getState().openBrowserTab({
      url: "https://example.org",
      sourceTabId: first.id,
    });
    const tabs = useWorkspaceStore.getState().layout.panes[0]!.tabs;
    expect(tabs.map((tab) => tab.id)).toEqual([first.id, second.id]);
    expect(tabs[1]?.title).toBe("example.org");
    expect(parseBrowserTabState(tabs[1]?.state).url).toBe("https://example.org");
  });

  it("updates browser metadata without retaining an old favicon", () => {
    const tab = useWorkspaceStore.getState().openBrowserTab({ url: "https://example.com" });
    useWorkspaceStore.getState().updateBrowserTab(tab.id, {
      url: "https://misty.com",
      title: "Misty",
    });
    const updated = useWorkspaceStore.getState().layout.panes[0]!.tabs[0]!;
    expect(updated.title).toBe("Misty");
    expect(parseBrowserTabState(updated.state)).toMatchObject({
      url: "https://misty.com",
      faviconUrl: "https://misty.com/favicon.ico",
    });
  });
});
