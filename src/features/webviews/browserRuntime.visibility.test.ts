import { createBrowserViewState, type WorkspaceView } from "@/features/workspace";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  hideBrowserWebview,
  parkAllBrowserWebviews,
  syncBrowserWebview,
  useBrowserRuntimeStore,
} from "./browserRuntime";

const invoke = vi.hoisted(() =>
  vi.fn<(command: string, args?: unknown) => Promise<unknown>>((command) =>
    Promise.resolve(command === "browser_webview_reconcile" ? true : undefined),
  ),
);

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

function browserTab(instanceKey: string): WorkspaceView {
  return {
    id: `tab:${instanceKey}`,
    surfaceId: "browser",
    groupKey: "tool:browser",
    instanceKey,
    title: "Browser",
    route: "/browser",
    sidebarVisible: true,
    state: createBrowserViewState("https://example.com"),
    createdAt: 1,
    lastFocusedAt: 1,
  };
}

describe("browser native view visibility", () => {
  beforeEach(() => {
    invoke.mockClear();
    invoke.mockImplementation((command) =>
      Promise.resolve(command === "browser_webview_reconcile" ? true : undefined),
    );
  });

  it("hides a child when its Browser surface closes during native creation", async () => {
    const tab = browserTab("hide-during-create");
    let releaseReconcile: ((exists: boolean) => void) | undefined;
    const reconcile = new Promise<boolean>((resolve) => {
      releaseReconcile = resolve;
    });
    invoke.mockImplementation((command) =>
      command === "browser_webview_reconcile" ? reconcile : Promise.resolve(undefined),
    );

    const syncing = syncBrowserWebview({
      tab,
      url: "https://example.com",
      bounds: { x: 10, y: 20, width: 800, height: 600 },
      theme: "dark",
    });
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("browser_webview_reconcile", expect.anything()),
    );
    const hiding = hideBrowserWebview(tab);
    releaseReconcile?.(true);
    await Promise.all([syncing, hiding]);

    const commands = invoke.mock.calls.map(([command]) => command);
    expect(commands[commands.length - 1]).toBe("browser_webview_hide");
    expect(commands.filter((command) => command === "browser_webview_hide")).toHaveLength(2);
  });

  it("recreates a native child when frontend state is stale", async () => {
    const tab = browserTab("native-recovery");
    await syncBrowserWebview({
      tab,
      url: "https://example.com",
      bounds: { x: 10, y: 20, width: 800, height: 600 },
      theme: "dark",
    });
    invoke.mockClear();
    invoke
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(true);

    await syncBrowserWebview({
      tab,
      url: "https://example.com",
      bounds: { x: 12, y: 20, width: 798, height: 600 },
      theme: "dark",
    });

    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      "browser_webview_reconcile",
      "browser_webview_create",
      "browser_webview_reconcile",
      "browser_webview_held",
    ]);
  });

  it("restores a parked browser at unchanged bounds without recreating its page or history", async () => {
    const tab = browserTab("park-and-return");
    const input = {
      tab,
      url: "https://example.com",
      bounds: { x: 10, y: 20, width: 800, height: 600 },
      theme: "dark" as const,
    };
    await syncBrowserWebview(input);
    useBrowserRuntimeStore.getState().replaceHistory(tab.id, {
      entries: ["https://example.com", "https://example.com/next"],
      index: 1,
    });
    const history = useBrowserRuntimeStore.getState().histories[tab.id];
    invoke.mockClear();

    await parkAllBrowserWebviews();
    expect(invoke).toHaveBeenCalledWith("browser_webviews_park_all");
    expect(invoke).not.toHaveBeenCalledWith("browser_webview_close", expect.anything());
    invoke.mockClear();

    await syncBrowserWebview(input);
    expect(invoke.mock.calls.map(([command]) => command)).toEqual(["browser_webview_reconcile"]);
    expect(useBrowserRuntimeStore.getState().histories[tab.id]).toEqual(history);
  });

  it("parks a browser after an in-flight native reveal finishes", async () => {
    const tab = browserTab("park-during-reconcile");
    let finishReconcile: ((exists: boolean) => void) | undefined;
    invoke.mockImplementation((command) =>
      command === "browser_webview_reconcile"
        ? new Promise<boolean>((resolve) => {
            finishReconcile = resolve;
          })
        : Promise.resolve(undefined),
    );
    const syncing = syncBrowserWebview({
      tab,
      url: "https://example.com",
      bounds: { x: 10, y: 20, width: 800, height: 600 },
      theme: "dark",
    });
    await vi.waitFor(() => expect(finishReconcile).toBeTypeOf("function"));
    const parking = parkAllBrowserWebviews();
    expect(invoke).not.toHaveBeenCalledWith("browser_webviews_park_all");

    finishReconcile?.(true);
    await Promise.all([syncing, parking]);
    expect(invoke.mock.calls.map(([command]) => command).slice(-2)).toEqual([
      "browser_webview_hide",
      "browser_webviews_park_all",
    ]);
  });
});
