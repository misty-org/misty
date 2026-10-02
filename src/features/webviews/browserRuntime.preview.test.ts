import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WorkspaceView } from "@/features/workspace";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
const image = {
  dataUrl: "data:image/png;base64,cHJldmlldw==",
  url: "https://example.test",
  width: 2560,
  height: 1600,
};
const tab = {
  id: "preview-tab",
  instanceKey: "preview",
  surfaceId: "browser",
  state: { url: "https://example.test", private: false },
} as WorkspaceView;
const bounds = { width: 800, height: 600 };
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  native.invoke
    .mockReset()
    .mockImplementation(async (command) =>
      command === "browser_webview_preview_document" ? image : true,
    );
});
afterEach(async () => {
  // Suspension resumes over two animation frames. Settle it before another
  // module instance or test reuses the native command mock.
  await vi.runAllTimersAsync();
  vi.useRealTimers();
});
async function setup(candidate = tab) {
  const runtime = await import("./browserRuntime");
  await runtime.syncBrowserWebview({
    tab: candidate,
    url: "https://example.test",
    bounds: { x: 0, y: 0, ...bounds },
    theme: "dark",
  });
  return runtime;
}

it("never captures private, hidden, loading, or suspended pages", async () => {
  const privateTab = { ...tab, state: { ...(tab.state as object), private: true } };
  const runtime = await setup(privateTab);
  await runtime.captureBrowserPagePreview(privateTab, bounds, () => true);
  runtime.useBrowserRuntimeStore.getState().setLoading(tab.id, true);
  await runtime.captureBrowserPagePreview(tab, bounds, () => true);
  runtime.useBrowserRuntimeStore.getState().setLoading(tab.id, false);
  runtime.setBrowserWebviewsSuspended(true, "test");
  await runtime.captureBrowserPagePreview(tab, bounds, () => true);
  runtime.setBrowserWebviewsSuspended(false, "test");
  await runtime.hideBrowserWebview(tab);
  await runtime.captureBrowserPagePreview(tab, bounds, () => true);
  expect(
    native.invoke.mock.calls.filter(([name]) => name === "browser_webview_preview_document"),
  ).toHaveLength(0);
});

it("discards captures that finish after navigation or profile replacement", async () => {
  const runtime = await setup();
  await runtime.captureBrowserPagePreview(tab, bounds, () => false);
  expect(runtime.useBrowserRuntimeStore.getState().previews).toEqual({});
  let finish!: (result: typeof image) => void;
  native.invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const capture = runtime.captureBrowserPagePreview(tab, bounds, () => true);
  await runtime.browserProfileChanged();
  finish(image);
  await capture;
  expect(runtime.useBrowserRuntimeStore.getState().previews).toEqual({});
});

it("keeps the fallback available when capture fails", async () => {
  const runtime = await setup();
  native.invoke.mockRejectedValueOnce(new Error("unavailable"));
  await expect(runtime.captureBrowserPagePreview(tab, bounds, () => true)).resolves.toBeUndefined();
  expect(runtime.useBrowserRuntimeStore.getState().previews).toEqual({});
});

it("prepares unopened tabs offscreen without focusing them", async () => {
  const runtime = await import("./browserRuntime");
  await runtime.prepareBrowserPagePreview(tab, () => true);
  expect(native.invoke).toHaveBeenCalledWith("browser_webview_create", {
    request: expect.objectContaining({
      id: expect.stringMatching(/^preview-/),
      previewOnly: true,
      x: 100_000,
      width: 1440,
      workspaceTabId: tab.id,
    }),
  });
  expect(native.invoke).toHaveBeenCalledWith("browser_webview_close", {
    request: { id: expect.stringMatching(/^preview-/) },
  });
  expect(runtime.useBrowserRuntimeStore.getState().previews[tab.id]?.dataUrl).toBe(image.dataUrl);
});

it("does not warm private tabs or cancelled requests", async () => {
  const runtime = await import("./browserRuntime");
  await runtime.prepareBrowserPagePreview(
    { ...tab, state: { url: "https://example.test", private: true } },
    () => true,
  );
  await runtime.prepareBrowserPagePreview(tab, () => false);
  expect(native.invoke).not.toHaveBeenCalled();
});
