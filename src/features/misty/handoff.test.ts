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

    await expect(openMisty({ prompt: "What is the status of my tasks?" })).resolves.toBeUndefined();

    const state = useMistyStore.getState();
    expect(state.panel).toBe("answer");
    expect(state.query).toBe("What is the status of my tasks?");
  });

  it("keeps handoffs in-app even if a legacy companion window exists", async () => {
    const companion = { emit: vi.fn(), show: vi.fn() };
    windowMocks.getByLabel.mockResolvedValue(companion);
    await openMisty({
      prompt: "Hello Misty",
      context: [{ kind: "file", id: "file-1", title: "Notes", source: "local" }],
    });
    expect(windowMocks.getByLabel).not.toHaveBeenCalled();
    expect(companion.emit).not.toHaveBeenCalled();
    expect(useMistyStore.getState().panel).toBe("answer");
    expect(useMistyStore.getState().query).toBe("Hello Misty");
    expect(useMistyStore.getState().context).toEqual([
      { kind: "file", id: "file-1", title: "Notes", source: "local" },
    ]);
  });

  it("opens in-app panel directly when running outside Tauri", async () => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

    await openMisty({ prompt: "Web prompt" });

    const state = useMistyStore.getState();
    expect(state.panel).toBe("answer");
    expect(state.query).toBe("Web prompt");
  });
});
