import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { companionControl, useCompanionState } from "./companionState";
import { CursorCompanionController } from "./CursorCompanionController";
import type { DisplayCapture } from "./protocol";
const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (e: { payload: unknown }) => void>(),
  invoke: vi.fn(),
  transcribe: vi.fn(),
  speech: vi.fn(),
  voiceClose: vi.fn(),
  voiceAppend: vi.fn(),
  voiceError: undefined as undefined | ((error: Error) => void),
  cancel: vi.fn(),
  pause: vi.fn(),
  taskId: "desktop-task",
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
vi.mock("../localExecution", () => ({
  useLocalExecution: { getState: () => ({ execution: { taskId: mocks.taskId } }) },
  pauseLocalExecution: mocks.pause,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));
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
vi.mock("@/shared/platform/tauri", () => ({
  hasTauriInternals: () => true,
}));
vi.mock("./companionVoice", () => ({
  CompanionVoice: class {
    private finish?: () => void;
    constructor(
      private options: {
        signal: AbortSignal;
        onPlaying: () => void;
        onError: (error: Error) => void;
      },
    ) {
      mocks.voiceError = options.onError;
    }
    append = mocks.voiceAppend;
    async commit() {
      const value = await mocks.transcribe(undefined, undefined, this.options.signal);
      return value.transcript;
    }
    async speak(id: string) {
      await mocks.speech(id, this.options.signal);
      if (this.options.signal.aborted) return;
      this.options.onPlaying();
      await new Promise<void>((resolve) => {
        this.finish = resolve;
      });
    }
    close() {
      mocks.voiceClose();
      this.finish?.();
    }
  },
}));
vi.mock("@/api/assistant/api", () => ({
  assistantApi: {
    frontierModels: async () => ({
      models: [],
    }),
  },
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
const emit = (event: string, payload: unknown) =>
  act(() => {
    mocks.listeners.get(`misty://cursor-${event}`)?.({
      payload,
    });
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
  mocks.taskId = "desktop-task";
  mocks.pause.mockResolvedValue(undefined);
  mocks.state.accountId = "account";
  mocks.state.working = false;
  mocks.state.error = null;
  mocks.state.invocationId = undefined;
  mocks.state.conversations = [];
  Object.defineProperty(navigator, "platform", {
    configurable: true,
    value: "MacIntel",
  });
  mocks.invoke.mockImplementation(
    async (
      name: string,
      args: {
        expectedTurn?: number;
      },
    ) =>
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
  mocks.transcribe.mockResolvedValue({
    transcript: "What is this?",
  });
  mocks.speech.mockResolvedValue(new Blob(["audio"]));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("native companion lifecycle", () => {
  it("keeps the owned task running if its voice connection dies while awaiting the answer", async () => {
    mocks.submit.mockImplementation(async () => {
      mocks.state.invocationId = "voice-task";
      mocks.state.working = true;
    });
    const view = await mounted();
    emit("shortcut", { turn: 2, held: true });
    emit("recorded", { turn: 2, durationMs: 1000 });
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
    await act(async () => {
      mocks.voiceError?.(new Error("Connection lost"));
    });
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.state.working).toBe(true);
    expect(useCompanionState.getState().presentation.error).toContain("task is still running");
    act(() => {
      mocks.state.working = false;
      mocks.state.conversations = [
        {
          id: "conversation",
          messages: [{ role: "assistant", state: "completed", content: "Saved answer" }],
        },
      ];
      mocks.subscribers.forEach((notify) => notify());
    });
    await waitFor(() =>
      expect(mocks.speech).toHaveBeenCalledWith("voice-task", expect.any(AbortSignal)),
    );
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(mocks.cancel).not.toHaveBeenCalled();
    view.unmount();
  });
  it("restores visibility and size, resizes without interrupting, and persists across remounts", async () => {
    localStorage.setItem(
      "misty.cursor-companion:account",
      JSON.stringify({
        visible: true,
        size: 150,
      }),
    );
    let view = await mounted();
    expect(presentations().slice(-1)[0]).toMatchObject({
      visible: true,
      showCompanion: true,
      size: 150,
    });
    await act(async () => {
      await companionControl({
        kind: "size",
        size: 200,
      });
    });
    expect(presentations().slice(-1)[0]).toMatchObject({
      size: 200,
      visible: true,
    });
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
    emit("shortcut", {
      turn: 2,
      held: true,
    });
    emit("shortcut", {
      turn: 2,
      held: false,
    });
    emit("recorded", {
      turn: 2,
      audio: "",
      durationMs: 0,
    });
    expect(presentations().slice(-1)[0]).toMatchObject({
      phase: "idle",
      point: undefined,
    });
    expect(mocks.transcribe).not.toHaveBeenCalled();
    mountedView.unmount();
  });
  it("microphone denial clears the indicator and interrupts the native recorder", async () => {
    const view = await mounted();
    emit("shortcut", {
      turn: 2,
      held: true,
    });
    emit("error", {
      turn: 2,
      error: "Microphone denied",
    });
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("cursor_companion_interrupt", {
        expectedTurn: 2,
      }),
    );
    expect(presentations().slice(-1)[0]).toMatchObject({
      phase: "idle",
      error: "Microphone denied",
    });
    view.unmount();
  });
  it("keeps a summoned companion visible after failure until explicitly hidden or retried", async () => {
    localStorage.setItem("misty.cursor-companion:account", JSON.stringify({ visible: false }));
    const view = await mounted();
    vi.useFakeTimers();
    emit("shortcut", { turn: 2, held: true });
    emit("error", { turn: 2, error: "Request failed" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(presentations().slice(-1)[0]).toMatchObject({
      visible: true,
      showCompanion: false,
      phase: "idle",
      error: "Request failed",
    });
    await act(async () => {
      await companionControl({ kind: "visibility", visible: false });
    });
    expect(presentations().slice(-1)[0].visible).toBe(false);
    emit("shortcut", { turn: 4, held: true });
    expect(presentations().slice(-1)[0]).toMatchObject({
      visible: true,
      phase: "listening",
      error: undefined,
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
    emit("shortcut", {
      turn: 2,
      held: true,
    });
    emit("recorded", {
      turn: 2,
      audio: "YQ==",
      durationMs: 1000,
    });
    await waitFor(() => expect(mocks.transcribe).toHaveBeenCalled());
    const signal = mocks.transcribe.mock.calls[0][2] as AbortSignal;
    emit("shortcut", {
      turn: 3,
      held: true,
    });
    expect(signal.aborted).toBe(true);
    await act(async () =>
      resolve({
        transcript: "open that page",
      }),
    );
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
    emit("shortcut", {
      turn: 2,
      held: true,
    });
    emit("recorded", {
      turn: 2,
      audio: "YQ==",
      durationMs: 1000,
    });
    await waitFor(() => expect(mocks.transcribe).toHaveBeenCalled());
    const signal = mocks.transcribe.mock.calls[0][2] as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    mocks.state.accountId = "other";
    await act(async () =>
      resolve({
        transcript: "private question",
      }),
    );
    expect(mocks.submit).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("cursor_companion_configure", {
        accountId: "",
      }),
    );
  });
  it("enabling Ask interrupts before persisting the next takeover policy", async () => {
    const view = await mounted();
    emit("shortcut", {
      turn: 2,
      held: true,
    });
    emit("control", {
      kind: "ask",
      ask: true,
    });
    await waitFor(() =>
      expect(presentations().slice(-1)[0]).toMatchObject({
        ask: true,
        phase: "idle",
      }),
    );
    const stop = mocks.invoke.mock.calls.findIndex(
      ([name]) => name === "cursor_companion_interrupt",
    );
    const changed = mocks.invoke.mock.calls.findIndex(
      ([name, args]) => name === "cursor_companion_present" && args.presentation.ask === true,
    );
    expect(stop).toBeLessThan(changed);
    expect(JSON.parse(localStorage.getItem("misty.cursor-companion:account")!)).toMatchObject({
      ask: true,
    });
    view.unmount();
  });
  it("provider failure returns idle and clears a companion-owned execution", async () => {
    mocks.submit.mockImplementationOnce(async () => {
      mocks.state.working = true;
      throw new Error("Provider unavailable");
    });
    const view = await mounted();
    emit("shortcut", {
      turn: 2,
      held: true,
    });
    emit("recorded", {
      turn: 2,
      audio: "YQ==",
      durationMs: 1000,
    });
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledTimes(1));
    expect(presentations().slice(-1)[0]).toMatchObject({
      phase: "idle",
      error: "Provider unavailable",
    });
    view.unmount();
  });
  it("a new press closes the voice session and keeps completed history", async () => {
    mocks.submit.mockImplementationOnce(async () => {
      mocks.state.invocationId = "invocation";
      mocks.state.working = false;
      mocks.state.conversations = [
        {
          id: "conversation",
          messages: [
            {
              role: "assistant",
              state: "completed",
              content: "here is the answer",
            },
          ],
        },
      ];
    });
    const view = await mounted();
    emit("shortcut", {
      turn: 2,
      held: true,
    });
    emit("recorded", {
      turn: 2,
      audio: "YQ==",
      durationMs: 1000,
    });
    await waitFor(() => expect(presentations().slice(-1)[0]?.phase).toBe("responding"));
    emit("shortcut", {
      turn: 3,
      held: true,
    });
    expect(mocks.voiceClose).toHaveBeenCalledOnce();
    expect(mocks.state.conversations).toHaveLength(1);
    expect(presentations().slice(-1)[0]).toMatchObject({
      phase: "listening",
      generation: 3,
    });
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
      await companionControl({
        kind: "ask",
        ask: true,
      });
    });
    expect(useCompanionState.getState().presentation.error).toBe("Native overlay failed");
    await act(async () => {
      await companionControl({
        kind: "retry",
      });
    });
    expect(useCompanionState.getState().presentation.error).toBeUndefined();
    expect(useCompanionState.getState().presentation.enabled).toBe(true);
    view.unmount();
  });
  it("the Agents page shares Ask changes and interrupts a typed request first", async () => {
    const view = await mounted();
    mocks.state.working = true;
    mocks.cancel.mockImplementationOnce(async () => {
      mocks.state.working = false;
    });
    await act(async () => {
      await companionControl({
        kind: "ask",
        ask: true,
      });
    });
    expect(mocks.cancel).toHaveBeenCalledOnce();
    expect(useCompanionState.getState().presentation.ask).toBe(true);
    expect(presentations().slice(-1)[0].ask).toBe(true);
    view.unmount();
    expect(useCompanionState.getState().control).toBeUndefined();
  });
});

describe("Clicky capture ordering and shared entry points", () => {
  it("keeps the answer and point after TTS fails, and retries speech without replaying the request", async () => {
    const capture: DisplayCapture = {
      id: "fixture",
      name: "fixture",
      screen: "screen1",
      primary: true,
      width: 1280,
      height: 720,
      mimeType: "image/jpeg",
      dataUrl: "",
      contentHash: "hash",
      display: { id: 1, x: -2560, y: 0, width: 2560, height: 1440, scale: 2 },
    };
    const native = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation((name, args) =>
      name === "cursor_companion_capture" ? Promise.resolve([capture]) : native(name, args),
    );
    mocks.submit.mockImplementationOnce(async () => {
      mocks.state.invocationId = "completed-invocation";
      mocks.state.conversations = [
        {
          id: "conversation",
          messages: [
            {
              role: "assistant",
              state: "completed",
              content: "BLUE LANTERN [POINT:640,360:button:screen1]",
            },
          ],
        },
      ];
    });
    mocks.speech.mockRejectedValue(new Error("The configured speech model is unavailable"));
    const view = await mounted();
    await act(async () =>
      useCompanionState.getState().submit!({
        prompt: "What is on my screen?",
        conversationId: "conversation",
      }),
    );
    await waitFor(() =>
      expect(useCompanionState.getState().presentation.error).toContain("answer is saved"),
    );
    expect(useCompanionState.getState().presentation).toMatchObject({
      visible: true,
      phase: "idle",
      point: { x: -1280, y: 720, displayId: 1 },
    });
    await act(async () => companionControl({ kind: "retry" }));
    expect(mocks.speech).toHaveBeenCalledTimes(2);
    expect(mocks.speech.mock.calls.every(([id]) => id === "completed-invocation")).toBe(true);
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.state.conversations).toHaveLength(1);
    view.unmount();
  });
  it("stop during native capture ignores late pixels and permits a fresh turn", async () => {
    let finish!: (captures: DisplayCapture[]) => void;
    const native = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation((name, args) =>
      name === "cursor_companion_capture"
        ? new Promise<DisplayCapture[]>((resolve) => {
            finish = resolve;
          })
        : native(name, args),
    );
    const view = await mounted();
    const request = useCompanionState.getState().submit!({
      prompt: "Explain this screen",
      conversationId: "conversation",
    }).catch((error) => error);
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    await act(async () => companionControl({ kind: "stop" }));
    await act(async () => {
      finish([]);
      await request;
    });
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(useCompanionState.getState().presentation).toMatchObject({
      phase: "idle",
      error: undefined,
    });
    emit("shortcut", { turn: 4, held: true });
    expect(useCompanionState.getState().presentation.phase).toBe("listening");
    view.unmount();
  });
  it("a new turn aborts pending speech and rejects its late audio", async () => {
    let finish!: (blob: Blob) => void;
    mocks.speech.mockImplementationOnce(
      () =>
        new Promise<Blob>((resolve) => {
          finish = resolve;
        }),
    );
    mocks.submit.mockImplementationOnce(async () => {
      mocks.state.invocationId = "completed-invocation";
      mocks.state.conversations = [
        {
          id: "conversation",
          messages: [{ role: "assistant", state: "completed", content: "An answer" }],
        },
      ];
    });
    const create = vi.spyOn(URL, "createObjectURL");
    const view = await mounted();
    await act(async () =>
      useCompanionState.getState().submit!({
        prompt: "What is on my screen?",
        conversationId: "conversation",
      }),
    );
    await waitFor(() => expect(mocks.speech).toHaveBeenCalledOnce());
    const signal = mocks.speech.mock.calls[0][1] as AbortSignal;
    emit("shortcut", { turn: 3, held: true });
    expect(signal.aborted).toBe(true);
    await act(async () => finish(new Blob(["late audio"])));
    expect(create).not.toHaveBeenCalled();
    expect(useCompanionState.getState().presentation).toMatchObject({
      generation: 3,
      phase: "listening",
      error: undefined,
    });
    view.unmount();
    create.mockRestore();
  });
  it("waits for final transcription before acquiring fresh displays", async () => {
    let finish!: (value: { transcript: string }) => void;
    mocks.transcribe.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = await mounted();
    emit("shortcut", { turn: 2, held: true });
    emit("recorded", { turn: 2, audio: "YQ==", durationMs: 1000 });
    await waitFor(() => expect(mocks.transcribe).toHaveBeenCalledOnce());
    expect(mocks.invoke.mock.calls.some(([name]) => name === "cursor_companion_capture")).toBe(
      false,
    );
    await act(async () => finish({ transcript: "What is this?" }));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("cursor_companion_capture", { turn: 2 }),
    );
    view.unmount();
  });
  it("typed follow-ups acquire a new capture in the same controller", async () => {
    mocks.submit.mockImplementation(async () => {
      mocks.state.invocationId = "typed";
      mocks.state.working = true;
    });
    const view = await mounted();
    await act(async () =>
      useCompanionState.getState().submit!({
        prompt: "Explain my screen",
        conversationId: "conversation",
      }),
    );
    expect(mocks.invoke).toHaveBeenCalledWith("cursor_companion_capture", { turn: 2 });
    expect(mocks.submit).toHaveBeenCalledWith(
      "Explain my screen",
      [],
      undefined,
      "workspace",
      [],
      { conversationId: "conversation", context: [] },
      expect.objectContaining({ turn: 2, displayCaptures: [] }),
    );
    expect(useCompanionState.getState().presentation.phase).toBe("processing");
    view.unmount();
  });
  it("duplicate native recording events do not create duplicate requests", async () => {
    mocks.submit.mockImplementation(async () => {
      mocks.state.invocationId = "voice";
      mocks.state.working = true;
    });
    const view = await mounted();
    emit("shortcut", { turn: 2, held: true });
    emit("recorded", { turn: 2, audio: "YQ==", durationMs: 1000 });
    emit("recorded", { turn: 2, audio: "YQ==", durationMs: 1000 });
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
    expect(mocks.transcribe).toHaveBeenCalledOnce();
    view.unmount();
  });
});

it("ignores a stale native Stop and stops only the matching task", async () => {
  const view = await mounted();
  await act(async () => {
    mocks.listeners.get("misty://desktop-control-stopped")?.({
      payload: { taskId: "old-task", reason: "Old stop" },
    });
  });
  expect(mocks.pause).not.toHaveBeenCalled();
  expect(useCompanionState.getState().presentation.error).not.toBe("Old stop");
  await act(async () => {
    mocks.listeners.get("misty://desktop-control-stopped")?.({
      payload: { taskId: "desktop-task", reason: "Stopped with Escape" },
    });
  });
  expect(mocks.pause).toHaveBeenCalledWith("desktop-task");
  expect(useCompanionState.getState().presentation.error).toBe("Stopped with Escape");
  view.unmount();
});
it("restores Ask only when explicitly enabled for this account", async () => {
  localStorage.setItem("misty.cursor-companion:account", JSON.stringify({ ask: true }));
  const view = await mounted();
  expect(useCompanionState.getState().presentation.ask).toBe(true);
  view.unmount();
});

it("does not let a delayed desktop Stop interrupt the next voice turn", async () => {
  const view = await mounted();
  await act(async () => {
    mocks.listeners.get("misty://desktop-control-stopped")?.({
      payload: { taskId: "desktop-task", reason: "Stopped old task" },
    });
    mocks.listeners.get("misty://cursor-shortcut")?.({ payload: { turn: 3, held: true } });
  });
  expect(useCompanionState.getState().presentation).toMatchObject({
    generation: 3,
    phase: "listening",
  });
  expect(useCompanionState.getState().presentation.error).toBeUndefined();
  view.unmount();
});
