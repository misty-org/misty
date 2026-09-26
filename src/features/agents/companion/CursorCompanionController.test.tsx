import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (e: { payload: unknown }) => void>(),
  invoke: vi.fn(),
  transcribe: vi.fn(),
  speech: vi.fn(),
  cancel: vi.fn(),
  submit: vi.fn(),
  state: {
    accountId: "account",
    activeConversationId: "conversation",
    working: false,
    error: null as string | null,
    invocationId: undefined as string | undefined,
    conversations: [] as unknown[],
  },
  subscribers: new Set<() => void>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    listen: async (name: string, cb: (e: { payload: unknown }) => void) => {
      mocks.listeners.set(name, cb);
      return () => {
        if (mocks.listeners.get(name) === cb) mocks.listeners.delete(name);
      };
    },
  }),
}));
vi.mock("@/shared/platform/tauri", () => ({ hasTauriInternals: () => true }));
vi.mock("@/api/agents/api", () => ({
  agentsApi: { transcribeVoice: mocks.transcribe, speech: mocks.speech },
}));
vi.mock("@/api/assistant/api", () => ({
  assistantApi: { frontierModels: async () => ({ models: [] }) },
}));
vi.mock("@/features/misty/useMistyStore", () => ({
  useMistyStore: {
    getState: () => ({
      ...mocks.state,
      setAccount: (accountId: string) => {
        mocks.state.accountId = accountId;
      },
      cancelResponse: mocks.cancel,
      submitAnswer: mocks.submit,
    }),
    subscribe: (cb: () => void) => {
      mocks.subscribers.add(cb);
      return () => mocks.subscribers.delete(cb);
    },
  },
}));
import { useCompanionState, companionControl } from "./companionState";
import { CursorCompanionController } from "./CursorCompanionController";
const emit = (event: string, payload: unknown) =>
  act(() => {
    mocks.listeners.get(`misty://cursor-${event}`)?.({ payload });
  });
const presentations = () =>
  mocks.invoke.mock.calls
    .filter(([name]) => name === "cursor_companion_present")
    .map(([, args]) => args.presentation);
async function mounted() {
  const result = render(<CursorCompanionController accountId="account" />);
  await waitFor(() => expect(presentations().length).toBeGreaterThan(0));
  return result;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.listeners.clear();
  mocks.subscribers.clear();
  localStorage.clear();
  mocks.state.accountId = "account";
  mocks.state.working = false;
  mocks.state.error = null;
  mocks.state.invocationId = undefined;
  mocks.state.conversations = [];
  Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
  mocks.invoke.mockImplementation(async (name: string, args: { expectedTurn?: number }) =>
    name === "cursor_companion_configure"
      ? 1
      : name === "cursor_companion_interrupt"
        ? (args.expectedTurn ?? 1) + 1
        : name === "cursor_companion_capture"
          ? []
          : undefined,
  );
  mocks.submit.mockReset();
  mocks.cancel.mockResolvedValue(undefined);
  mocks.transcribe.mockResolvedValue({ transcript: "What is this?" });
  mocks.speech.mockResolvedValue(new Blob(["audio"]));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("native companion lifecycle", () => {
  it("restores visibility and size, resizes without interrupting, and persists across remounts", async () => {
    localStorage.setItem(
      "misty.cursor-companion:account",
      JSON.stringify({ visible: true, size: 150 }),
    );
    let view = await mounted();
    expect(presentations().slice(-1)[0]).toMatchObject({ visible: true, showCompanion: true, size: 150 });
    await act(async () => {
      await companionControl({ kind: "size", size: 200 });
    });
    expect(presentations().slice(-1)[0]).toMatchObject({ size: 200, visible: true });
    expect(mocks.invoke.mock.calls.some(([name]) => name === "cursor_companion_interrupt")).toBe(
      false,
    );
    expect(JSON.parse(localStorage.getItem("misty.cursor-companion:account")!)).toMatchObject({
      size: 200,
      visible: true,
    });
    view.unmount();
    view = await mounted();
    await waitFor(() =>
      expect(useCompanionState.getState().presentation).toMatchObject({
        size: 200,
        visible: true,
        enabled: true,
      }),
    );
    view.unmount();
  });

  it("rapid release returns to idle without a provider request", async () => {
    const mountedView = await mounted();
    emit("shortcut", { turn: 2, held: true });
    emit("shortcut", { turn: 2, held: false });
    emit("recorded", { turn: 2, audio: "", durationMs: 0 });
    expect(presentations().slice(-1)[0]).toMatchObject({ phase: "idle", point: undefined });
    expect(mocks.transcribe).not.toHaveBeenCalled();
    mountedView.unmount();
  });
  it("microphone denial clears the indicator and interrupts the native recorder", async () => {
    const view = await mounted();
    emit("shortcut", { turn: 2, held: true });
    emit("error", { turn: 2, error: "Microphone denied" });
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("cursor_companion_interrupt", { expectedTurn: 2 }),
    );
    expect(presentations().slice(-1)[0]).toMatchObject({
      phase: "idle",
      error: "Microphone denied",
    });
    view.unmount();
  });
  it("a new press aborts transcription and discards its late result", async () => {
    let resolve!: (value: object) => void;
    mocks.transcribe.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const view = await mounted();
    emit("shortcut", { turn: 2, held: true });
    emit("recorded", { turn: 2, audio: "YQ==", durationMs: 1000 });
    await waitFor(() => expect(mocks.transcribe).toHaveBeenCalled());
    const signal = mocks.transcribe.mock.calls[0][2] as AbortSignal;
    emit("shortcut", { turn: 3, held: true });
    expect(signal.aborted).toBe(true);
    await act(async () => resolve({ transcript: "open that page" }));
    expect(mocks.submit).not.toHaveBeenCalled();
    view.unmount();
  });
  it("logout aborts an in-flight transcription and closes native overlays", async () => {
    let resolve!: (value: object) => void;
    mocks.transcribe.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const view = await mounted();
    emit("shortcut", { turn: 2, held: true });
    emit("recorded", { turn: 2, audio: "YQ==", durationMs: 1000 });
    await waitFor(() => expect(mocks.transcribe).toHaveBeenCalled());
    const signal = mocks.transcribe.mock.calls[0][2] as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    mocks.state.accountId = "other";
    await act(async () => resolve({ transcript: "private question" }));
    expect(mocks.submit).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("cursor_companion_configure", { accountId: "" }),
    );
  });
  it("changing mode interrupts before publishing the new mode", async () => {
    const view = await mounted();
    emit("shortcut", { turn: 2, held: true });
    emit("control", { kind: "mode", mode: "auto" });
    await waitFor(() =>
      expect(presentations().slice(-1)[0]).toMatchObject({ mode: "auto", phase: "idle" }),
    );
    const stop = mocks.invoke.mock.calls.findIndex(
      ([name]) => name === "cursor_companion_interrupt",
    );
    const changed = mocks.invoke.mock.calls.findIndex(
      ([name, args]) => name === "cursor_companion_present" && args.presentation.mode === "auto",
    );
    expect(stop).toBeLessThan(changed);
    view.unmount();
  });
  it("provider failure returns idle and clears a companion-owned execution", async () => {
    mocks.submit.mockImplementationOnce(async () => {
      mocks.state.working = true;
      throw new Error("Provider unavailable");
    });
    const view = await mounted();
    emit("shortcut", { turn: 2, held: true });
    emit("recorded", { turn: 2, audio: "YQ==", durationMs: 1000 });
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledTimes(1));
    expect(presentations().slice(-1)[0]).toMatchObject({
      phase: "idle",
      error: "Provider unavailable",
    });
    view.unmount();
  });
  it("a new press stops spoken audio, revokes its URL and keeps completed history", async () => {
    const pause = vi.fn(),
      removeAttribute = vi.fn(),
      revoke = vi.fn();
    let player!: { onended: null | (() => void); onerror: null | (() => void) };
    vi.stubGlobal(
      "Audio",
      class {
        onended = null;
        onerror = null;
        pause = pause;
        removeAttribute = removeAttribute;
        play = async () => {};
        constructor() {
          // eslint-disable-next-line @typescript-eslint/no-this-alias -- expose the fake player to verify disposal
          player = this;
        }
      },
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:companion-speech");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(revoke);
    mocks.submit.mockImplementationOnce(async () => {
      mocks.state.invocationId = "invocation";
      mocks.state.working = false;
      mocks.state.conversations = [
        {
          id: "conversation",
          messages: [{ role: "assistant", state: "completed", content: "here is the answer" }],
        },
      ];
    });
    const view = await mounted();
    emit("shortcut", { turn: 2, held: true });
    emit("recorded", { turn: 2, audio: "YQ==", durationMs: 1000 });
    await waitFor(() => expect(presentations().slice(-1)[0]?.phase).toBe("responding"));
    emit("shortcut", { turn: 3, held: true });
    expect(pause).toHaveBeenCalledOnce();
    expect(removeAttribute).toHaveBeenCalledWith("src");
    expect(revoke).toHaveBeenCalledWith("blob:companion-speech");
    expect(player.onended).toBeNull();
    expect(mocks.state.conversations).toHaveLength(1);
    expect(presentations().slice(-1)[0]).toMatchObject({ phase: "listening", generation: 3 });
    view.unmount();
    vi.restoreAllMocks();
  });
  it("publishes native startup failures in Agents and retries through the page control", async () => {
    mocks.invoke.mockImplementationOnce(async (name: string) => {
      if (name === "cursor_companion_configure") throw new Error("Native overlay failed");
    });
    const view = render(<CursorCompanionController accountId="account" />);
    await waitFor(() =>
      expect(useCompanionState.getState().presentation.error).toBe("Native overlay failed"),
    );
    await act(async () => {
      await companionControl({ kind: "mode", mode: "auto" });
    });
    expect(useCompanionState.getState().presentation.error).toBe("Native overlay failed");
    await act(async () => {
      await companionControl({ kind: "retry" });
    });
    expect(useCompanionState.getState().presentation.error).toBeUndefined();
    expect(useCompanionState.getState().presentation.enabled).toBe(true);
    view.unmount();
  });
  it("the Agents page shares mode changes and interrupts a typed request first", async () => {
    const view = await mounted();
    mocks.state.working = true;
    mocks.cancel.mockImplementationOnce(async () => {
      mocks.state.working = false;
    });
    await act(async () => {
      await companionControl({ kind: "mode", mode: "auto" });
    });
    expect(mocks.cancel).toHaveBeenCalledOnce();
    expect(useCompanionState.getState().presentation.mode).toBe("auto");
    expect(presentations().slice(-1)[0].mode).toBe("auto");
    view.unmount();
    expect(useCompanionState.getState().control).toBeUndefined();
  });
});
