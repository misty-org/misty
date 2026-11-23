import "./CompanionController.testFixtures";
import { act, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { emit, mocks, mounted, opened } from "./CompanionController.testFixtures";
import { companionControl, useCompanionState } from "./companion_state";
import type { MistyImageAttachment } from "@/features/agents/conversations/state/conversation_types";
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

it("routes a spoken follow-up for the agent already on it through steering", async () => {
  const view = await mounted();
  mocks.state.working = true;
  mocks.state.invocationId = "active";
  mocks.state.invocationConversationId = "thread";
  mocks.state.conversations = [
    { id: "conversation", messages: [] },
    { id: "thread", agentId: "ada", messages: [] },
  ];
  emit("shortcut", { turn: 2, held: true });
  await opened();
  let id: string | undefined;
  await act(async () => {
    id = await mocks.conversationOptions!.tool(
      {
        name: "start_task",
        callId: "one",
        key: "voice-1:one",
        instruction: "Only PDFs",
        invocationId: "",
      },
      "conversation",
    );
  });
  expect(id).toBe("active");
  expect(mocks.steer).toHaveBeenCalledWith("Only PDFs", "thread");
  expect(mocks.cancel).not.toHaveBeenCalled();
  expect(mocks.submit).not.toHaveBeenCalled();
  view.unmount();
});
it("keeps Tutor's own conversation when the open chat changes", async () => {
  const view = await mounted();
  emit("shortcut", { turn: 2, held: true });
  await opened();
  mocks.state.activeConversationId = "other";
  act(() => mocks.subscribers.forEach((notify) => notify()));
  expect(mocks.conversationClose).not.toHaveBeenCalled();
  view.unmount();
});
it("answers ordinary voice without screenshots or task admission and reuses the session", async () => {
  const view = await mounted();
  emit("shortcut", { turn: 2, held: true });
  await opened();
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
  await opened();
  act(() => mocks.conversationOptions!.onError(new Error("Voice disconnected")));
  expect(mocks.cancel).not.toHaveBeenCalled();
  expect(mocks.state.working).toBe(true);
  expect(mocks.state.invocationId).toBe("active");
  expect(mocks.state.error).toBeNull();
  expect(useCompanionState.getState().presentation.error).toBe("Voice disconnected");
  view.unmount();
});
it("delegates only on a tool request with its stable admission key", async () => {
  const view = await mounted();
  emit("shortcut", { turn: 2, held: true });
  await opened();
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
    [],
    { conversationId: "conversation", context: [] },
    expect.objectContaining({ idempotencyKey: "tutor-1:call", turn: 2 }),
  );
  expect(mocks.speech).not.toHaveBeenCalled();
  view.unmount();
  expect(mocks.cancel).not.toHaveBeenCalled();
});
it("sends spoken screen questions with the screens", async () => {
  const view = await mounted();
  emit("shortcut", { turn: 2, held: true });
  await opened();
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
  expect(mocks.invoke).toHaveBeenCalledWith("cursor_companion_capture", expect.anything());
  expect(mocks.submit).toHaveBeenCalledWith(
    "Describe the screen without changing anything.",
    [],
    undefined,
    [],
    { conversationId: "conversation", context: [] },
    expect.objectContaining({ executionMode: "user", idempotencyKey: "tutor-1:screen" }),
  );
  expect(mocks.submit.mock.calls[0][5]).not.toHaveProperty("displayCaptures");
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
  await opened();
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

it.each(["user", "agent"] as const)(
  "delegates voice work in user mode after a %s task, with the screens",
  async (previous) => {
    const view = await mounted();
    mocks.state.executionMode = previous;
    emit("shortcut", { turn: 2, held: true });
    await opened();
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
    expect(mocks.invoke).toHaveBeenCalledWith("cursor_companion_capture", expect.anything());
    expect(mocks.submit).toHaveBeenCalledExactlyOnceWith(
      instruction,
      [],
      undefined,
      [],
      { conversationId: "conversation", context: [] },
      expect.objectContaining({ executionMode: "user", idempotencyKey: "tutor-browser:call" }),
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
  await opened();
  mocks.state.activeConversationId = "other";
  act(() => mocks.conversationOptions!.onError(new Error("Model admission denied")));
  expect(mocks.state.error).toBeNull();
  view.unmount();
});
