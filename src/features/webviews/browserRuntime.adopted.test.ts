import { beforeEach, expect, it, vi } from "vitest";
import type { WorkspaceView } from "@/features/workspace";
const native = vi.hoisted(() => ({ invoke: vi.fn(), exists: true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
beforeEach(() => {
  vi.resetModules();
  native.exists = true;
  native.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "browser_webview_reconcile") return native.exists;
    if (command === "browser_webview_held") return false;
    if (command === "browser_webviews_show_only") return [];
    return undefined;
  });
});
const bounds = { x: 400, y: 60, width: 600, height: 500 };
const calls = (name: string) => native.invoke.mock.calls.filter(([command]) => command === name);

it("shows an agent's page through the tab pages' reconcile, never creating it", async () => {
  const runtime = await import("./browserRuntime");
  await runtime.showAdoptedBrowserPage("agent-1", "agent-page:agent-1", bounds);
  expect(calls("browser_webview_create")).toHaveLength(0);
  expect(calls("browser_webview_reconcile")[0]![1]).toEqual({
    request: { id: "agent-1", nativeLiveResize: false, ...bounds },
  });
  expect(runtime.useBrowserRuntimeStore.getState().presented["agent-page:agent-1"]).toBe(true);
  // The same place again is no native call at all.
  await runtime.showAdoptedBrowserPage("agent-1", "agent-page:agent-1", bounds);
  expect(calls("browser_webview_reconcile")).toHaveLength(1);
});

it("leaves a page its owner closed off screen", async () => {
  const runtime = await import("./browserRuntime");
  native.exists = false;
  await runtime.showAdoptedBrowserPage("agent-1", "agent-page:agent-1", bounds);
  expect(calls("browser_webview_create")).toHaveLength(0);
  expect(runtime.useBrowserRuntimeStore.getState().presented["agent-page:agent-1"]).toBeFalsy();
});

it("keeps an agent's page up when the Agents page parks the tabs", async () => {
  const runtime = await import("./browserRuntime");
  const tab = { id: "tab-1", instanceKey: "one" } as WorkspaceView;
  await runtime.syncBrowserWebview({ tab, url: "https://example.test", bounds, theme: "dark" });
  await runtime.showAdoptedBrowserPage("agent-1", "agent-page:agent-1", bounds);
  await runtime.parkAllBrowserWebviews();
  expect(calls("browser_webviews_park_all")[0]![1]).toEqual({ request: { keep: ["agent-1"] } });
  const presented = runtime.useBrowserRuntimeStore.getState().presented;
  expect(presented["agent-page:agent-1"]).toBe(true);
  expect(presented["tab-1"]).toBeFalsy();
  // Shown again at the same place: still on screen, so nothing to do.
  await runtime.showAdoptedBrowserPage("agent-1", "agent-page:agent-1", bounds);
  expect(
    calls("browser_webview_reconcile").filter(([, args]) => args.request.id === "agent-1"),
  ).toHaveLength(1);
});

it("keeps an agent's page up through a switch of tabs (Windows)", async () => {
  const runtime = await import("./browserRuntime");
  await runtime.showAdoptedBrowserPage("agent-1", "agent-page:agent-1", bounds);
  runtime.switchBrowserPages([]);
  expect(calls("browser_webviews_show_only")[0]![1]).toEqual({ request: { ids: ["agent-1"] } });
});

it("hides an agent's page live and forgets it", async () => {
  const runtime = await import("./browserRuntime");
  runtime.setBrowserRuntimeKeepLive("agent-1", true);
  await runtime.showAdoptedBrowserPage("agent-1", "agent-page:agent-1", bounds);
  await runtime.hideAdoptedBrowserPage("agent-1");
  expect(calls("browser_webview_hide").slice(-1)[0]![1]).toEqual({
    request: { id: "agent-1", keepLive: true },
  });
  expect(runtime.useBrowserRuntimeStore.getState().presented["agent-page:agent-1"]).toBe(false);
  // Gone from the runtime: parking no longer keeps it.
  await runtime.parkAllBrowserWebviews();
  expect(calls("browser_webviews_park_all")[0]).toEqual(["browser_webviews_park_all"]);
});
