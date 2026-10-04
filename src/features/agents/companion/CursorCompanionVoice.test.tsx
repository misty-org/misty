// Spoken conversations, delegated voice tasks and stopping audio.
import "./CompanionController.testFixtures";
import { act, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { emit, mocks, mounted } from "./CompanionController.testFixtures";
import { companionControl, useCompanionState } from "./companionState";
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

it("routes a requested spoken follow-up through steering without restarting work", async () => {
  const view = await mounted();
  mocks.state.working = true;
  mocks.state.invocationId = "active";
  mocks.state.invocationConversationId = "conversation";
  emit("shortcut", { turn: 2, held: true });
  await act(async () => {
    await mocks.conversationOptions!.tool(
      {
        name: "steer_task",
        callId: "one",
        key: "stable",
        instruction: "Only PDFs",
        invocationId: "active",
      },
      "conversation",
    );
  });
  expect(mocks.steer).toHaveBeenCalledWith("Only PDFs", "conversation");
  expect(mocks.cancel).not.toHaveBeenCalled();
  expect(mocks.submit).not.toHaveBeenCalled();
  view.unmount();
});
it("closes voice and rejects a delayed action after the conversation changes", async () => {
  const view = await mounted();
  emit("shortcut", { turn: 2, held: true });
  const options = mocks.conversationOptions!;
  mocks.state.activeConversationId = "other";
  act(() => mocks.subscribers.forEach((notify) => notify()));
  expect(mocks.conversationClose).toHaveBeenCalled();
  await expect(
    options.tool(
      {
        name: "start_task",
        callId: "late",
        key: "stable",
        instruction: "Organize files",
        invocationId: "",
      },
      "conversation",
    ),
  ).rejects.toThrow("changed");
  expect(mocks.submit).not.toHaveBeenCalled();
  view.unmount();
});
it("answers ordinary voice without screenshots or task admission and reuses the session", async () => {
  const view = await mounted();
  emit("shortcut", { turn: 2, held: true });
  emit("recorded", { turn: 2, durationMs: 1000 });
  emit("recorded", { turn: 2, durationMs: 1000 });
  await waitFor(() => expect(mocks.conversationCommit).toHaveBeenCalledOnce());
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(mocks.invoke.mock.calls.some(([name]) => name === "cursor_companion_capture")).toBe(false);
  act(() =>
    mocks.conversationOptions!.onDone({
      id: "voice-one",
      prompt: "How are you?",
      reply: "Ready to help.",
      interrupted: false,
    }),
  );
  emit("shortcut", { turn: 3, held: true });
  expect(mocks.conversationOpen).toHaveBeenCalledOnce();
  expect(mocks.conversationBegin).toHaveBeenCalledTimes(2);
  expect(mocks.conversationClose).not.toHaveBeenCalled();
  expect(mocks.state.conversations).toEqual([
    expect.objectContaining({
      messages: expect.arrayContaining([expect.objectContaining({ content: "Ready to help." })]),
    }),
  ]);
  view.unmount();
  expect(mocks.conversationClose).toHaveBeenCalledOnce();
});
it("voice failure preserves an admitted task and saved history", async () => {
  const view = await mounted();
  mocks.state.working = true;
  mocks.state.invocationId = "active";
  emit("shortcut", { turn: 2, held: true });
  act(() => mocks.conversationOptions!.onError(new Error("Voice disconnected")));
  expect(mocks.cancel).not.toHaveBeenCalled();
  expect(mocks.state.working).toBe(true);
  expect(mocks.state.invocationId).toBe("active");
  expect(mocks.state.error).toBe("Voice: Voice disconnected");
  expect(useCompanionState.getState().presentation.error).toBe("Voice disconnected");
  view.unmount();
});
it("delegates only on a tool request with its stable admission key", async () => {
  const view = await mounted();
  emit("shortcut", { turn: 2, held: true });
  mocks.submit.mockImplementationOnce(async () => {
    mocks.state.invocationId = "admitted";
    mocks.state.working = true;
  });
  let id: string | undefined;
  await act(async () => {
    id = await mocks.conversationOptions!.tool(
      {
        name: "start_task",
        callId: "call",
        key: "voice-1:call",
        instruction: "Organize my folder",
        invocationId: "",
      },
      "conversation",
    );
  });
  expect(id).toBe("admitted");
  expect(mocks.submit).toHaveBeenCalledWith(
    "Organize my folder",
    [],
    undefined,
    "workspace",
    [],
    { conversationId: "conversation", context: [] },
    expect.objectContaining({ idempotencyKey: "voice-1:call", turn: 2 }),
  );
  expect(mocks.speech).not.toHaveBeenCalled();
  view.unmount();
  expect(mocks.cancel).not.toHaveBeenCalled();
});
it("delegates screen questions without capturing the screen up front", async () => {
  const view = await mounted();
  emit("shortcut", { turn: 2, held: true });
  await act(async () => {
    await mocks.conversationOptions!.tool(
      {
        name: "start_task",
        callId: "screen",
        key: "voice-1:screen",
        instruction: "Describe the screen without changing anything.",
        invocationId: "",
      },
      "conversation",
    );
  });
  // The task calls screen_look when it needs the screen.
  expect(mocks.invoke).not.toHaveBeenCalledWith("cursor_companion_capture", expect.anything());
  expect(mocks.submit).toHaveBeenCalledWith(
    "Describe the screen without changing anything.",
    [],
    undefined,
    "workspace",
    [],
    { conversationId: "conversation", context: [] },
    expect.objectContaining({ executionMode: "user", idempotencyKey: "voice-1:screen" }),
  );
  expect(mocks.submit.mock.calls[0][6]).not.toHaveProperty("displayCaptures");
  view.unmount();
});
it("stops audio without canceling business actions", async () => {
  const view = await mounted();
  mocks.state.working = true;
  mocks.state.invocationId = "active";
  await act(async () => companionControl({ kind: "stop_audio" }));
  expect(mocks.cancel).not.toHaveBeenCalled();
  expect(mocks.state.working).toBe(true);
  view.unmount();
});

it.each(["stop_audio", "renderer_error", "microphone_error", "close", "retry"] as const)(
  "keeps an admitted companion task running after %s",
  async (action) => {
    mocks.submit.mockImplementation(async () => {
      mocks.state.invocationId = "admitted-browser-task";
      mocks.state.working = true;
    });
    const view = await mounted();
    await act(async () =>
      useCompanionState.getState().submit!({
        prompt: "Organize these notes",
        attachments: [attachment],
        conversationId: "conversation",
      }),
    );
    expect(mocks.state.invocationId).toBe("admitted-browser-task");
    await act(async () => {
      if (action === "close") view.unmount();
      else if (action === "renderer_error") emit("renderer-error", { error: "Overlay closed" });
      else if (action === "microphone_error")
        emit("error", { turn: 2, error: "Microphone disconnected" });
      else await companionControl({ kind: action });
    });
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.state.working).toBe(true);
    expect(mocks.state.invocationId).toBe("admitted-browser-task");
    view.unmount();
  },
);

it("explicit Stop task still cancels an active task after audio stops", async () => {
  const view = await mounted();
  mocks.state.working = true;
  mocks.state.invocationId = "admitted-browser-task";
  await act(async () => companionControl({ kind: "stop_audio" }));
  expect(mocks.cancel).not.toHaveBeenCalled();
  await act(async () => companionControl({ kind: "stop" }));
  expect(mocks.cancel).toHaveBeenCalledOnce();
  view.unmount();
});

it("speaks the saved result of delegated work without replaying the task", async () => {
  const view = await mounted();
  emit("shortcut", { turn: 2, held: true });
  emit("recorded", { turn: 2, durationMs: 1000 });
  mocks.submit.mockImplementationOnce(async () => {
    mocks.state.invocationId = "task";
    mocks.state.working = true;
  });
  await act(async () => {
    await mocks.conversationOptions!.tool(
      {
        name: "start_task",
        callId: "one",
        key: "voice-one:call",
        instruction: "Inspect files",
        invocationId: "",
      },
      "conversation",
    );
  });
  act(() =>
    mocks.conversationOptions!.onDone({
      id: "voice-one",
      prompt: "Inspect files",
      reply: "I have started.",
      interrupted: false,
    }),
  );
  await act(async () => {
    mocks.state.working = false;
    mocks.state.conversations = [
      {
        id: "conversation",
        messages: [
          {
            id: "saved",
            role: "assistant",
            state: "completed",
            invocationId: "task",
            content: "I found two files.",
          },
        ],
      },
    ];
    mocks.subscribers.forEach((notify) => notify());
  });
  await waitFor(() => expect(mocks.speech).toHaveBeenCalledWith("task"));
  expect(mocks.submit).toHaveBeenCalledOnce();
  view.unmount();
});

it.each(["user", "agent", "team"] as const)(
  "delegates voice work in user mode after a %s task, leaving screens to the task",
  async (previous) => {
    const view = await mounted();
    mocks.state.executionMode = previous;
    emit("shortcut", { turn: 2, held: true });
    const instruction = "Find this week's videos and create the requested playlist.";
    await act(async () => {
      await mocks.conversationOptions!.tool(
        {
          name: "start_task",
          callId: "browser-task",
          key: "voice-browser:call",
          instruction,
          invocationId: "",
        },
        "conversation",
      );
    });
    expect(mocks.invoke).not.toHaveBeenCalledWith("cursor_companion_capture", expect.anything());
    expect(mocks.submit).toHaveBeenCalledExactlyOnceWith(
      instruction,
      [],
      undefined,
      "workspace",
      [],
      { conversationId: "conversation", context: [] },
      expect.objectContaining({ executionMode: "user", idempotencyKey: "voice-browser:call" }),
    );
    view.unmount();
  },
);

it("refreshes a resumed worker invocation only in the matching account, agent and conversation", async () => {
  const view = await mounted();
  mocks.state.selectedAgentId = "agent";
  const receipt = {
    accountId: "account",
    agentId: "agent",
    conversationId: "conversation",
    invocationId: "resumed",
  };
  const notify = (payload: typeof receipt) =>
    act(() => {
      mocks.listeners.get("misty://agent-task-admitted")?.({ payload });
    });
  notify({ ...receipt, accountId: "other" });
  notify({ ...receipt, agentId: "other" });
  notify({ ...receipt, conversationId: "other" });
  expect(mocks.loadConversations).not.toHaveBeenCalled();
  notify(receipt);
  expect(mocks.loadConversations).toHaveBeenCalledExactlyOnceWith(true, receipt);
  expect(mocks.submit).not.toHaveBeenCalled();
  mocks.state.invocationId = "resumed";
  notify(receipt);
  expect(mocks.loadConversations).toHaveBeenCalledOnce();
  view.unmount();
});
it("does not publish an old voice session error into a different conversation", async () => {
  const view = await mounted();
  emit("shortcut", { turn: 2, held: true });
  mocks.state.activeConversationId = "other";
  act(() => mocks.conversationOptions!.onError(new Error("Billing admission denied")));
  expect(mocks.state.error).toBeNull();
  view.unmount();
});
