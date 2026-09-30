import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dockLeaves } from "@/features/workspace/dockTree";
import { createBrowserViewState, type WorkspaceView } from "@/features/workspace/model";
import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import {
  browserRuntimeId,
  closeBrowserRuntime,
  hideBrowserWebview,
  syncBrowserWebview,
  useBrowserRuntimeStore,
} from "@/features/webviews/browserRuntime";
import type { ProjectedWorkspace } from "./projection";
import { workspaceSource } from "./source";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

let tab: WorkspaceView;
function projection(url = "https://example.test/", title = "Page"): ProjectedWorkspace {
  const next = { ...tab, title, state: createBrowserViewState(url) };
  const root = { type: "leaf" as const, id: "pane:a", views: [next], activeViewId: tab.id };
  const layout = { id: "layout:a", root, focusedPaneId: root.id };
  return {
    windows: [
      {
        id: "window:a",
        title: "Work",
        createdAt: 0,
        lastFocusedAt: 0,
        layout: { ...layout, tabs: [layout], activeTabId: layout.id },
      },
    ],
    activeWindowId: "window:a",
    folders: [],
    bookmarks: [],
    recoveryViewIds: [],
  };
}
const open = () =>
  syncBrowserWebview({
    tab,
    url: "https://example.test/",
    theme: "dark",
    bounds: { x: 0, y: 0, width: 400, height: 300 },
  });
async function settled() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
beforeEach(async () => {
  invoke.mockReset();
  invoke.mockImplementation(async (command) =>
    command === "browser_webview_reconcile" ? true : undefined,
  );
  tab = {
    id: `tab:${crypto.randomUUID()}`,
    instanceKey: crypto.randomUUID(),
    surfaceId: "browser",
    groupKey: "tool:browser",
    route: "/browser",
    title: "Page",
    sidebarVisible: false,
    state: createBrowserViewState("https://example.test/"),
    createdAt: 0,
    lastFocusedAt: 0,
  };
  useWorkspaceStore.setState({ windowsByScope: { global: [] } });
  workspaceSource.write(projection());
  await settled();
  invoke.mockClear();
});
afterEach(async () => {
  await hideBrowserWebview(tab);
  await closeBrowserRuntime(tab);
});

describe("synced browser navigation", () => {
  it("never reloads a page on screen; the remote URL loads once it is hidden, without reloading on an echo", async () => {
    await open();
    invoke.mockClear();
    workspaceSource.write(projection("https://youtube.com/"));
    await settled();
    expect(dockLeaves(useWorkspaceStore.getState().layout.root)[0].views[0].state).toMatchObject({
      url: "https://youtube.com/",
    });
    expect(invoke).not.toHaveBeenCalledWith("browser_webview_navigate", expect.anything());
    await hideBrowserWebview(tab);
    await settled();
    expect(invoke.mock.calls.filter(([command]) => command === "browser_webview_navigate")).toEqual(
      [
        [
          "browser_webview_navigate",
          {
            request: { id: browserRuntimeId(tab), url: "https://youtube.com/" },
          },
        ],
      ],
    );
    invoke.mockClear();
    workspaceSource.write(projection("https://youtube.com/"));
    workspaceSource.write(projection("https://youtube.com/", "YouTube"));
    await settled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("navigates a hidden existing page without revealing or focusing it", async () => {
    await open();
    await hideBrowserWebview(tab);
    invoke.mockClear();
    workspaceSource.write(projection("https://youtube.com/"));
    await settled();
    expect(invoke.mock.calls.map(([command]) => command)).toEqual(["browser_webview_navigate"]);
  });

  it("leaves unopened native pages to load their projected URL on creation", async () => {
    workspaceSource.write(projection("https://youtube.com/"));
    await settled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("waits for an in-flight native creation before navigating", async () => {
    let finish!: () => void;
    invoke.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const creating = open();
    await settled();
    workspaceSource.write(projection("https://youtube.com/"));
    await settled();
    expect(invoke).not.toHaveBeenCalledWith("browser_webview_navigate", expect.anything());
    finish();
    await creating;
    await hideBrowserWebview(tab);
    await settled();
    expect(invoke).toHaveBeenCalledWith("browser_webview_navigate", {
      request: { id: browserRuntimeId(tab), url: "https://youtube.com/" },
    });
  });

  it("does not navigate to an obsolete remote URL after a newer local edit", async () => {
    await open();
    invoke.mockClear();
    workspaceSource.write(projection("https://youtube.com/"));
    useWorkspaceStore.getState().updateBrowserView(tab.id, { url: "https://local.test/" });
    await settled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("surfaces a native navigation failure", async () => {
    await open();
    await hideBrowserWebview(tab);
    invoke.mockRejectedValueOnce(new Error("Navigation failed"));
    workspaceSource.write(projection("https://youtube.com/"));
    await settled();
    expect(useBrowserRuntimeStore.getState().errors[tab.id]).toBe("Navigation failed");
    expect(useBrowserRuntimeStore.getState().loading[tab.id]).toBe(false);
  });
});
