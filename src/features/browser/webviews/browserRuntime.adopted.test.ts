import { beforeEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ invoke: vi.fn(), exists: true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
beforeEach(() => {
  vi.resetModules();
  native.exists = true;
  native.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "browser_webview_reconcile") return native.exists;
    if (command === "browser_webview_held") return false;
    return undefined;
  });
});
const bounds = { x: 400, y: 60, width: 600, height: 500 };
const calls = (name: string) => native.invoke.mock.calls.filter(([command]) => command === name);
const load = async () => ({
  ...(await import("./browserRuntime")),
  ...(await import("@/features/app-windows")),
});

it("shows an agent's page through a reconcile, never creating it", async () => {
  const runtime = await load();
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
  const runtime = await load();
  native.exists = false;
  await runtime.showAdoptedBrowserPage("agent-1", "agent-page:agent-1", bounds);
  expect(calls("browser_webview_create")).toHaveLength(0);
  expect(runtime.useBrowserRuntimeStore.getState().presented["agent-page:agent-1"]).toBeFalsy();
});

it("hides an agent's page live and forgets it", async () => {
  const runtime = await load();
  runtime.setBrowserRuntimeKeepLive("agent-1", true);
  await runtime.showAdoptedBrowserPage("agent-1", "agent-page:agent-1", bounds);
  await runtime.hideAdoptedBrowserPage("agent-1");
  expect(calls("browser_webview_hide").slice(-1)[0]![1]).toEqual({
    request: { id: "agent-1", keepLive: true },
  });
  expect(runtime.useBrowserRuntimeStore.getState().presented["agent-page:agent-1"]).toBe(false);
  expect(runtime.adoptedPages.has("agent-1")).toBe(false);
});
