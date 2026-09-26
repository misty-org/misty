import { beforeEach, expect, it, vi } from "vitest";
import type { WorkspaceTab } from "@/features/workspace";
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
beforeEach(() => {
  vi.resetModules();
  native.invoke.mockReset().mockResolvedValue(true);
});
const input = {
  tab: { id: "tab-1", instanceKey: "one" } as WorkspaceTab,
  url: "https://example.test",
  bounds: { x: 0, y: 0, width: 800, height: 600 },
  theme: "dark" as const,
};
it("recreates an unchanged visible pane after native profile replacement and preserves history", async () => {
  const runtime = await import("./browserRuntime");
  await runtime.syncBrowserWebview(input);
  await runtime.syncBrowserWebview(input);
  expect(
    native.invoke.mock.calls.filter(([command]) => command === "browser_webview_create"),
  ).toHaveLength(1);
  runtime.useBrowserRuntimeStore.getState().ensureHistory("tab-1", input.url);
  runtime.useBrowserRuntimeStore
    .getState()
    .setGrants("tab-1", [
      { id: "old", agentId: "agent", spaceId: "", scopeId: "old", expiresAt: "later" },
    ]);
  const resumed = vi.fn();
  window.addEventListener(runtime.browserRuntimeResumeEvent, resumed);
  try {
    await runtime.browserProfileChanged();
    expect(runtime.browserRuntimeCreated(input.tab)).toBe(false);
    expect(runtime.useBrowserRuntimeStore.getState().grants).toEqual({});
    expect(runtime.useBrowserRuntimeStore.getState().histories["tab-1"].entries).toEqual([
      input.url,
    ]);
    expect(resumed).toHaveBeenCalledTimes(1);
    await runtime.syncBrowserWebview(input);
    expect(
      native.invoke.mock.calls.filter(([command]) => command === "browser_webview_create"),
    ).toHaveLength(2);
  } finally {
    window.removeEventListener(runtime.browserRuntimeResumeEvent, resumed);
  }
});
it("waits for old commands, then rechecks account identity before clearing handles", async () => {
  const runtime = await import("./browserRuntime");
  let complete!: (result: boolean) => void;
  native.invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const creating = runtime.syncBrowserWebview(input);
  await vi.waitFor(() => expect(native.invoke).toHaveBeenCalled());
  let current = true;
  const switching = runtime.browserProfileChanged(() => current);
  current = false;
  complete(true);
  await creating;
  await switching;
  expect(runtime.browserRuntimeCreated(input.tab)).toBe(true);
  await runtime.browserProfileChanged();
  expect(runtime.browserRuntimeCreated(input.tab)).toBe(false);
});
