import "./CompanionController.testFixtures";
import { effectiveValues } from "@/features/settings/device-preferences/settingResolution";
import { useDevicePreferences } from "@/features/settings/device-preferences/store";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { emit, mocks, mounted, presentations } from "./CompanionController.testFixtures";
import { companionControl, useCompanionState } from "./companionState";
import { CursorCompanionController } from "./CursorCompanionController";
import type { DisplayCapture } from "./protocol";
import type { MistyImageAttachment } from "@/features/agents/conversations/state/conversationTypes";
const attachment: MistyImageAttachment = {
  id: "fixture-file",
  name: "notes.txt",
  mimeType: "text/plain",
  byteSize: 5,
  width: 0,
  height: 0,
  previewUrl: "",
  state: "ready",
};
describe("native companion lifecycle", () => {
  it("completes typed attachment requests without opening a voice session", async () => {
    mocks.submit.mockImplementation(async () => {
      mocks.state.invocationId = "typed-task";
      mocks.state.working = true;
    });
    const view = await mounted();
    await act(async () =>
      useCompanionState.getState().submit!({
        prompt: "Explain this problem",
        attachments: [attachment],
        conversationId: "conversation",
      }),
    );
    expect(mocks.conversationOpen).not.toHaveBeenCalled();
    expect(mocks.transcribe).not.toHaveBeenCalled();
    expect(mocks.speech).not.toHaveBeenCalled();
    await act(async () => {
      mocks.state.working = false;
      mocks.state.conversations = [
        {
          id: "conversation",
          messages: [{ role: "assistant", state: "completed", content: "The verified answer." }],
        },
      ];
      mocks.subscribers.forEach((notify) => notify());
    });
    expect(useCompanionState.getState().presentation.phase).toBe("idle");
    expect(mocks.speech).not.toHaveBeenCalled();
    expect(mocks.conversationOpen).not.toHaveBeenCalled();
    view.unmount();
  });

  it("starts hidden whatever was saved, resizes without interrupting, and persists across remounts", async () => {
    localStorage.setItem(
      "misty.cursor-companion:account",
      JSON.stringify({
        visible: true,
        size: 150,
      }),
    );
    let view = await mounted();
    expect(presentations().slice(-1)[0]).toMatchObject({
      visible: false,
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
      visible: false,
    });
    expect(mocks.invoke.mock.calls.some(([name]) => name === "cursor_companion_interrupt")).toBe(
      false,
    );
    expect(
      Object.fromEntries(
        Object.entries(effectiveValues(useDevicePreferences.getState().state!)).map(
          ([key, value]) => [key.replace("agents.companion.", ""), value],
        ),
      ),
    ).toMatchObject({
      size: 200,
    });
    view.unmount();
    view = await mounted();
    await waitFor(() =>
      expect(useCompanionState.getState().presentation).toMatchObject({
        size: 200,
        visible: false,
        enabled: true,
      }),
    );
    view.unmount();
  });
  it("shows the cursor for a talk turn and hides it when the turn ends", async () => {
    const view = await mounted();
    vi.useFakeTimers();
    emit("shortcut", { turn: 2, held: true });
    expect(presentations().slice(-1)[0]).toMatchObject({ visible: true, phase: "listening" });
    emit("shortcut", { turn: 2, held: false });
    emit("recorded", { turn: 2, audio: "", durationMs: 0 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(presentations().slice(-1)[0]).toMatchObject({ visible: false, phase: "idle" });
    view.unmount();
  });
  it("never shows the cursor or a point for a request that was not spoken", async () => {
    mocks.submit.mockImplementation(async () => {
      mocks.state.invocationId = "typed-task";
      mocks.state.working = true;
    });
    const view = await mounted();
    await act(async () =>
      useCompanionState.getState().submit!({
        prompt: "Where is the button?",
        conversationId: "conversation",
      }),
    );
    await act(async () => {
      mocks.state.working = false;
      mocks.state.conversations = [
        {
          id: "conversation",
          messages: [
            {
              role: "assistant",
              state: "completed",
              content: "There. [POINT:100,200:the button:screen1]",
            },
          ],
        },
      ];
      mocks.subscribers.forEach((notify) => notify());
    });
    expect(presentations().every((presented) => !presented.visible && !presented.point)).toBe(true);
    expect(presentations().slice(-1)[0].phase).toBe("idle");
    view.unmount();
  });
  it("stays up for the next step of what the talk shortcut started", async () => {
    mocks.submit.mockImplementation(async () => {
      mocks.state.invocationId = "spoken-task";
      mocks.state.working = true;
    });
    const view = await mounted();
    await act(async () =>
      useCompanionState.getState().submit!({
        prompt: "Where is the button?",
        conversationId: "conversation",
        voice: true,
      }),
    );
    expect(presentations().slice(-1)[0]).toMatchObject({ visible: true, phase: "processing" });
    view.unmount();
  });
  it("hides the overlay when sending a talk turn's recording fails", async () => {
    mocks.conversationCommit.mockRejectedValue(new Error("No voice model"));
    const view = await mounted();
    vi.useFakeTimers();
    emit("shortcut", { turn: 2, held: true });
    emit("shortcut", { turn: 2, held: false });
    emit("recorded", { turn: 2, audio: "", durationMs: 1000 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(presentations().slice(-1)[0]).toMatchObject({
      visible: false,
      phase: "idle",
      error: "No voice model",
    });
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
  it("shows a failed talk turn for a moment, then hides and keeps the error for Agents", async () => {
    const view = await mounted();
    vi.useFakeTimers();
    emit("shortcut", { turn: 2, held: true });
    emit("error", { turn: 2, error: "Request failed" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(presentations().slice(-1)[0]).toMatchObject({
      visible: true,
      phase: "idle",
      error: "Request failed",
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(presentations().slice(-1)[0]).toMatchObject({
      visible: false,
      error: "Request failed",
    });
    emit("shortcut", { turn: 4, held: true });
    expect(presentations().slice(-1)[0]).toMatchObject({
      visible: true,
      phase: "listening",
      error: undefined,
    });
    view.unmount();
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
    expect(
      Object.fromEntries(
        Object.entries(effectiveValues(useDevicePreferences.getState().state!)).map(
          ([key, value]) => [key.replace("agents.companion.", ""), value],
        ),
      ),
    ).toMatchObject({
      ask: true,
    });
    view.unmount();
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
  it("keeps a delegated voice answer and point after TTS fails, and retries speech without replaying the request", async () => {
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
              invocationId: "completed-invocation",
            },
          ],
        },
      ];
    });
    mocks.speech.mockRejectedValue(new Error("The configured speech model is unavailable"));
    const view = await mounted();
    emit("shortcut", { turn: 2, held: true });
    emit("recorded", { turn: 2, durationMs: 1000 });
    await act(async () => {
      await mocks.conversationOptions!.tool(
        {
          name: "start_task",
          callId: "screen",
          key: "voice-screen:call",
          instruction: "What is on my screen?",
          invocationId: "",
        },
        "conversation",
      );
      mocks.conversationOptions!.onDone({
        id: "voice-screen",
        prompt: "",
        reply: "",
        interrupted: false,
      });
    });
    await waitFor(() =>
      expect(useCompanionState.getState().presentation.error).toContain("answer is saved"),
    );
    // The request carried the screens; the answer had no point to show.
    expect(useCompanionState.getState().presentation).toMatchObject({
      visible: true,
      phase: "idle",
    });
    expect(mocks.invoke).toHaveBeenCalledWith("cursor_companion_capture", expect.anything());
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
      prompt: "Continue the request above.",
      conversationId: "conversation",
      look: true,
      continuation: true,
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

  it("captures every display with each request at the cursor", async () => {
    mocks.submit.mockImplementation(async () => {
      mocks.state.invocationId = "typed";
      mocks.state.working = true;
    });
    const view = await mounted();
    await act(async () =>
      useCompanionState.getState().submit!({
        prompt: "Explain my screen",
        attachments: [attachment],
        conversationId: "conversation",
      }),
    );
    // Every request at the cursor carries the screens.
    expect(mocks.invoke).toHaveBeenCalledWith("cursor_companion_capture", expect.anything());
    mocks.state.working = false;
    await act(async () =>
      useCompanionState.getState().submit!({
        prompt: "Continue the request above.",
        conversationId: "conversation",
        look: true,
        continuation: true,
      }),
    );
    expect(mocks.invoke).toHaveBeenCalledWith("cursor_companion_capture", { turn: 3 });
    expect(mocks.submit).toHaveBeenLastCalledWith(
      "Continue the request above.",
      [],
      undefined,
      [],
      { conversationId: "conversation", context: [] },
      expect.objectContaining({ turn: 3, continuation: true, executionMode: "user" }),
    );
    expect(useCompanionState.getState().presentation.phase).toBe("processing");
    view.unmount();
  });
});
