import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  sync: vi.fn().mockResolvedValue(undefined),
  layout: vi.fn(),
  hide: vi.fn(),
}));
vi.mock("./browserRuntime", () => ({
  browserRuntimeResumeEvent: "misty:browser-runtime-resume",
  syncBrowserWebview: runtime.sync,
  requestBrowserWebviewLayout: runtime.layout,
  hideBrowserWebview: runtime.hide,
  useBrowserRuntimeStore: { getState: () => ({ errors: {}, setError: vi.fn() }) },
}));
vi.mock("@/shared/hooks/useAppZoom", () => ({
  appZoomChangedEvent: "misty:app-zoom-changed",
  getAppliedAppRenderScale: () => 1,
}));
import { useBrowserWebviewGeometry } from "./useBrowserWebviewGeometry";
import type { WorkspaceTab } from "@/features/workspace";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("lets AppKit own a resize burst and reconciles only the final DOM bounds", async () => {
  vi.useFakeTimers();
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  runtime.layout.mockImplementation(() =>
    window.dispatchEvent(new Event("misty:browser-runtime-resume")),
  );
  const frames = new Map<number, FrameRequestCallback>();
  let sequence = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++sequence, callback);
    return sequence;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const host = document.createElement("div");
  document.body.append(host);
  let width = 500;
  vi.spyOn(host, "getBoundingClientRect").mockImplementation(
    () => ({ left: 10, top: 60, right: 10 + width, bottom: 360, width, height: 300 }) as DOMRect,
  );
  const flush = async () => {
    await act(async () => {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(0));
    });
  };
  renderHook(() =>
    useBrowserWebviewGeometry({
      hostRef: { current: host },
      nativeRuntime: true,
      nativeLiveResize: true,
      tab: { id: "browser", instanceKey: "browser" } as WorkspaceTab,
      url: "https://example.com",
      theme: "dark",
    }),
  );
  await flush();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  await flush();
  runtime.sync.mockClear();
  for (width of [480, 460, 440]) {
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("resize"));
    expect(frames.size).toBe(0);
    // Even an unrelated recovery notification must not overwrite native size.
    window.dispatchEvent(new Event("misty:browser-runtime-resume"));
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16);
    });
    expect(runtime.sync).not.toHaveBeenCalled();
  }
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120);
  });
  await flush();
  expect(runtime.sync).toHaveBeenCalledTimes(1);
  expect(runtime.sync).toHaveBeenLastCalledWith(
    expect.objectContaining({ bounds: { x: 10, y: 60, width: 440, height: 300 } }),
  );
  host.remove();
});
