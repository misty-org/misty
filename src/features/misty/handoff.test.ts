import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useMistyStore } from "./useMistyStore";

const windowMocks = vi.hoisted(() => ({
  getByLabel: vi.fn(),
  getCurrentWindow: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  Window: {
    getByLabel: windowMocks.getByLabel,
  },
  getCurrentWindow: windowMocks.getCurrentWindow,
}));

import { openMisty } from "./handoff";

describe("openMisty", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useMistyStore.setState({
      panel: "closed",
      mode: "ask",
      query: "",
      context: [],
      conversations: [],
      conversationsLoading: false,
    });
    windowMocks.getByLabel.mockReset();
    windowMocks.getCurrentWindow.mockReset().mockReturnValue({
      label: "main",
      listen: vi.fn(),
    });
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {
      invoke: vi.fn(),
    };
  });

  afterEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("opens in-app Misty panel without throwing when desktop companion window is unavailable", async () => {
    windowMocks.getByLabel.mockResolvedValue(null);

    await expect(
      openMisty({ prompt: "What is the status of my tasks?" }),
    ).resolves.toBeUndefined();

    const state = useMistyStore.getState();
    expect(state.panel).toBe("answer");
    expect(state.query).toBe("What is the status of my tasks?");
  });

  it("delegates to companion window when companion window is available", async () => {
    const companionMock = {
      emit: vi.fn().mockResolvedValue(undefined),
      show: vi.fn().mockResolvedValue(undefined),
    };
    windowMocks.getByLabel.mockResolvedValue(companionMock);

    let listener: ((event: { payload: { requestId: string; error?: string } }) => void) | undefined;
    windowMocks.getCurrentWindow.mockReturnValue({
      label: "main",
      listen: vi.fn(async (_event, callback) => {
        listener = callback;
        return () => {};
      }),
    });

    companionMock.emit.mockImplementation(async (_event, payload: { requestId: string }) => {
      queueMicrotask(() => {
        listener?.({ payload: { requestId: payload.requestId } });
      });
    });

    await openMisty({ prompt: "Hello companion" });

    expect(companionMock.emit).toHaveBeenCalledOnce();
    expect(companionMock.show).toHaveBeenCalledOnce();
  });

  it("falls back to in-app panel if companion handoff fails", async () => {
    const companionMock = {
      emit: vi.fn().mockRejectedValue(new Error("RPC failed")),
      show: vi.fn().mockResolvedValue(undefined),
    };
    windowMocks.getByLabel.mockResolvedValue(companionMock);

    windowMocks.getCurrentWindow.mockReturnValue({
      label: "main",
      listen: vi.fn(async () => () => {}),
    });

    await expect(openMisty({ prompt: "Fallback test" })).resolves.toBeUndefined();

    const state = useMistyStore.getState();
    expect(state.panel).toBe("answer");
    expect(state.query).toBe("Fallback test");
  });

  it("opens in-app panel directly when running outside Tauri", async () => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

    await openMisty({ prompt: "Web prompt" });

    const state = useMistyStore.getState();
    expect(state.panel).toBe("answer");
    expect(state.query).toBe("Web prompt");
  });
});
