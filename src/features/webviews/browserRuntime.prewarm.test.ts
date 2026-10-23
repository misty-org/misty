import { createBrowserViewState, type WorkspaceView } from "@/features/workspace";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  prewarmBrowserWebview,
  syncBrowserWebview,
  useBrowserRuntimeStore,
} from "./browserRuntime";

const native = vi.hoisted(() => ({ held: 0 }));
const invoke = vi.hoisted(() => vi.fn<(command: string, args?: unknown) => Promise<unknown>>());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const browserTab = (instanceKey: string): WorkspaceView => ({
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
});
const bounds = { x: 10, y: 50, width: 800, height: 600 };
const commands = () => invoke.mock.calls.map(([command]) => command);

beforeEach(() => {
  native.held = 0;
  invoke.mockReset();
  invoke.mockImplementation((command) => {
    if (command === "browser_webview_reconcile") return Promise.resolve(true);
    // The page is held off screen until it paints: a couple of checks.
    if (command === "browser_webview_held") return Promise.resolve(native.held-- > 0);
    return Promise.resolve(undefined);
  });
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
});

afterEach(() => {
  vi.restoreAllMocks();
});

it("loads a page out of sight, then lets it wait beneath the app once it has painted", async () => {
  native.held = 2;
  const tab = browserTab("prewarm-beneath");
  await prewarmBrowserWebview({ tab, url: "https://example.com", bounds, theme: "dark" });
  expect(commands()).toEqual([
    "browser_webview_create",
    "browser_webview_reconcile",
    "browser_webview_hide",
    "browser_webview_held",
    "browser_webview_held",
    "browser_webview_held",
    "browser_webview_reconcile",
    "browser_webview_hide",
  ]);
  expect(invoke).toHaveBeenCalledWith("browser_webview_reconcile", {
    request: expect.objectContaining({ ...bounds, beneath: true }),
  });
  // It never counts as on screen.
  expect(useBrowserRuntimeStore.getState().presented[tab.id]).toBeFalsy();
  // A second request leaves the page as it is.
  invoke.mockClear();
  await prewarmBrowserWebview({ tab, url: "https://example.com", bounds, theme: "dark" });
  expect(invoke).not.toHaveBeenCalled();
});

it("stops settling a page whose tab is shown meanwhile", async () => {
  native.held = 100;
  const tab = browserTab("prewarm-shown");
  const loading = prewarmBrowserWebview({ tab, url: "https://example.com", bounds, theme: "dark" });
  await vi.waitFor(() => expect(commands()).toContain("browser_webview_held"));
  await syncBrowserWebview({ tab, url: "https://example.com", bounds, theme: "dark" });
  await loading;
  expect(invoke).not.toHaveBeenCalledWith("browser_webview_reconcile", {
    request: expect.objectContaining({ beneath: true }),
  });
});

it("keeps the old path elsewhere: no settling beneath outside Windows", async () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  const tab = browserTab("prewarm-mac");
  await prewarmBrowserWebview({ tab, url: "https://example.com", bounds, theme: "dark" });
  expect(commands()).toEqual([
    "browser_webview_create",
    "browser_webview_reconcile",
    "browser_webview_hide",
  ]);
});
