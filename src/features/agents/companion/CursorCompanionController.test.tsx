import "./CompanionController.testFixtures";
import { effectiveValues } from "@/features/settings/profiles/model";
import { useSettingsProfiles } from "@/features/settings/profiles/store";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { emit, mocks, mounted, presentations } from "./CompanionController.testFixtures";
import { companionControl, useCompanionState } from "./companionState";
import { CursorCompanionController } from "./CursorCompanionController";
import type { DisplayCapture } from "./protocol";
import type { MistyImageAttachment } from "@/features/global-search/types";
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
    expect(
      Object.fromEntries(
        Object.entries(effectiveValues(useSettingsProfiles.getState().state!)).map(
          ([key, value]) => [key.replace("agents.companion.", ""), value],
        ),
      ),
    ).toMatchObject({
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
        Object.entries(effectiveValues(useSettingsProfiles.getState().state!)).map(
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
          needsScreen: true,
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
      attachments: [attachment],
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

  it("attachment follow-ups acquire a new capture in the same controller", async () => {
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
    expect(mocks.invoke).toHaveBeenCalledWith("cursor_companion_capture", { turn: 2 });
    expect(mocks.submit).toHaveBeenCalledWith(
      "Explain my screen",
      [attachment],
      undefined,
      "workspace",
      [],
      { conversationId: "conversation", context: [] },
      expect.objectContaining({ turn: 2, displayCaptures: [] }),
    );
    expect(useCompanionState.getState().presentation.phase).toBe("processing");
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

it("sends and completes plain text while the realtime provider is unavailable", async () => {
  mocks.conversationCommit.mockRejectedValue(
    new Error("The realtime voice provider is unavailable"),
  );
  mocks.speech.mockRejectedValue(new Error("The realtime voice provider is unavailable"));
  mocks.submit.mockImplementation(async () => {
    mocks.state.invocationId = "text-task";
    mocks.state.working = true;
  });
  const view = await mounted();
  await act(async () =>
    useCompanionState.getState().submit!({
      prompt: "How are you?",
      conversationId: "conversation",
    }),
  );
  expect(mocks.submit).toHaveBeenCalledWith(
    "How are you?",
    [],
    undefined,
    "workspace",
    [],
    { conversationId: "conversation", context: [] },
    expect.objectContaining({ executionMode: "user", displayCaptures: [] }),
  );
  expect(mocks.conversationOpen).not.toHaveBeenCalled();
  expect(mocks.conversationCommit).not.toHaveBeenCalled();
  expect(mocks.invoke.mock.calls.some(([name]) => name === "cursor_companion_capture")).toBe(false);
  await act(async () => {
    mocks.state.working = false;
    mocks.state.conversations = [
      {
        id: "conversation",
        messages: [{ role: "assistant", state: "completed", content: "Ready to help." }],
      },
    ];
    mocks.subscribers.forEach((notify) => notify());
  });
  expect(useCompanionState.getState().presentation).toMatchObject({
    phase: "idle",
    error: undefined,
  });
  expect(mocks.state.error).toBeNull();
  expect(mocks.state.conversations).toEqual([
    expect.objectContaining({ messages: [expect.objectContaining({ content: "Ready to help." })] }),
  ]);
  expect(mocks.speech).not.toHaveBeenCalled();
  expect(mocks.conversationOpen).not.toHaveBeenCalled();
  view.unmount();
});

it.each([
  ["user", "team"],
  ["agent", "agent"],
  ["team", "team"],
] as const)("routes typed web work from %s to %s without realtime", async (selected, expected) => {
  mocks.state.executionMode = selected;
  mocks.submit.mockImplementation(async () => {
    mocks.state.invocationId = "browser-task";
    mocks.state.working = true;
  });
  const view = await mounted();
  await act(async () =>
    useCompanionState.getState().submit!({
      prompt: "can you open instagram on the browser, find a person called Stone",
      conversationId: "conversation",
    }),
  );
  expect(mocks.submit).toHaveBeenCalledWith(
    expect.stringContaining("open instagram"),
    [],
    undefined,
    "workspace",
    [],
    { conversationId: "conversation", context: [] },
    expect.objectContaining({ executionMode: expected, displayCaptures: [] }),
  );
  expect(mocks.conversationOpen).not.toHaveBeenCalled();
  expect(mocks.invoke.mock.calls.some(([name]) => name === "cursor_companion_capture")).toBe(false);
  view.unmount();
});

it("submits a typed screen question through the text runtime without realtime", async () => {
  mocks.submit.mockImplementation(async () => {
    mocks.state.invocationId = "screen-task";
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
  expect(mocks.submit).toHaveBeenCalledOnce();
  expect(mocks.conversationOpen).not.toHaveBeenCalled();
  view.unmount();
});

it("admits ordinary text even when the native companion fails to start", async () => {
  const native = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((name, args) =>
    name === "cursor_companion_configure"
      ? Promise.reject(new Error("Native overlay failed"))
      : native(name, args),
  );
  mocks.submit.mockImplementation(async () => {
    mocks.state.invocationId = "text-task";
    mocks.state.working = true;
  });
  const view = render(<CursorCompanionController accountId="account" />);
  await waitFor(() =>
    expect(useCompanionState.getState().presentation.error).toBe("Native overlay failed"),
  );
  await act(async () =>
    useCompanionState.getState().submit!({
      prompt: "Hello",
      conversationId: "conversation",
    }),
  );
  expect(mocks.submit).toHaveBeenCalledOnce();
  expect(mocks.conversationOpen).not.toHaveBeenCalled();
  view.unmount();
});

it("rejects a stale typed conversation before capturing or admitting work", async () => {
  const view = await mounted();
  await expect(
    useCompanionState.getState().submit!({
      prompt: "Hello",
      conversationId: "previous-conversation",
    }),
  ).rejects.toThrow("conversation changed");
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(mocks.conversationOpen).not.toHaveBeenCalled();
  expect(mocks.invoke.mock.calls.some(([name]) => name === "cursor_companion_capture")).toBe(false);
  view.unmount();
});
