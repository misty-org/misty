import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  isMaximized: vi.fn(),
  onResized: vi.fn(),
  unlisten: vi.fn(),
}));
vi.mock("@/native", () => ({ enableModernWindowStyle: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@tauri-apps/plugin-os", () => ({ platform: () => "macos" }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));

import { useDesktopWindowChrome } from "./DesktopLayout/useDesktopWindowChrome";

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  native.isMaximized.mockResolvedValue(false);
  native.onResized.mockResolvedValue(native.unlisten);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("queries titlebar state once after a burst of native resize events", async () => {
  renderHook(() => useDesktopWindowChrome());
  await act(async () => {});
  expect(native.isMaximized).toHaveBeenCalledTimes(1);
  const resize = native.onResized.mock.calls[0][0];
  await act(async () => {
    for (let i = 0; i < 30; i++) {
      resize();
      await vi.advanceTimersByTimeAsync(8);
    }
  });
  expect(native.isMaximized).toHaveBeenCalledTimes(1);
  native.isMaximized.mockResolvedValue(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120);
  });
  expect(native.isMaximized).toHaveBeenCalledTimes(2);
});

it("cancels the pending status check when the shell unmounts", async () => {
  const hook = renderHook(() => useDesktopWindowChrome());
  await act(async () => {});
  native.onResized.mock.calls[0][0]();
  hook.unmount();
  await vi.runAllTimersAsync();
  expect(native.isMaximized).toHaveBeenCalledTimes(1);
  expect(native.unlisten).toHaveBeenCalledTimes(1);
});
