// Spoken screen questions, continuations after a screen request, and
// walkthrough steps that wait for the person's click.
import "./CompanionController.testFixtures";
import { act, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { emit, mocks, mounted, presentations } from "./CompanionController.testFixtures";
import { useCompanionState } from "./companionState";
import type { DisplayCapture } from "./protocol";

const screen: DisplayCapture = {
  id: "capture",
  name: "screen1",
  mimeType: "image/jpeg",
  dataUrl: "data:image/jpeg;base64,AA==",
  contentHash: "hash",
  width: 1280,
  height: 720,
  screen: "screen1",
  primary: true,
  display: { id: 1, x: 0, y: 0, width: 1280, height: 720, scale: 1 },
};

function captureScreens() {
  mocks.invoke.mockImplementation(async (name: string, args: { expectedTurn?: number }) =>
    name === "cursor_companion_configure"
      ? 1
      : name === "cursor_companion_interrupt"
        ? (args.expectedTurn ?? 1) + 1
        : name === "cursor_companion_capture"
          ? [screen]
          : undefined,
  );
}

function complete(invocationId: string, content: string, extra: Record<string, unknown> = {}) {
  act(() => {
    mocks.state.working = false;
    mocks.state.invocationId = invocationId;
    mocks.state.invocationConversationId = "conversation";
    mocks.state.conversations = [
      {
        id: "conversation",
        messages: [
          ...((mocks.state.conversations[0] as { messages?: unknown[] })?.messages ?? []).filter(
            (m) => (m as { invocationId?: string }).invocationId !== invocationId,
          ),
          {
            id: invocationId,
            role: "assistant",
            state: "completed",
            invocationId,
            content,
            ...extra,
          },
        ],
      },
    ];
    mocks.subscribers.forEach((notify) => notify());
  });
}

const admits = (invocationId: string) =>
  mocks.submit.mockImplementationOnce(async () => {
    mocks.state.invocationId = invocationId;
    mocks.state.invocationConversationId = "conversation";
    mocks.state.working = true;
  });

it("answers a spoken screen question from fresh captures, then points and reads it", async () => {
  captureScreens();
  const view = await mounted();
  emit("shortcut", { turn: 2, held: true });
  emit("recorded", { turn: 2, durationMs: 1000 });
  admits("teach");
  let id: string | undefined;
  await act(async () => {
    id = await mocks.conversationOptions!.tool(
      {
        name: "show_on_screen",
        callId: "show",
        key: "voice-1:show",
        instruction: "where do I commit?",
        invocationId: "",
      },
      "conversation",
    );
  });
  expect(id).toBe("teach");
  expect(mocks.invoke).toHaveBeenCalledWith("cursor_companion_capture", { turn: 2 });
  expect(mocks.submit.mock.calls[0][6]).toMatchObject({
    displayCaptures: [screen],
    intent: "teach",
    idempotencyKey: "voice-1:show",
  });
  act(() =>
    mocks.conversationOptions!.onDone({
      id: "voice-1",
      prompt: "where do I commit?",
      reply: "taking a look.",
      interrupted: false,
    }),
  );
  complete("teach", "it's in the toolbar. [POINT:640,360:click Commit:screen1]");
  await waitFor(() => expect(mocks.speech).toHaveBeenCalledWith("teach"));
  await waitFor(() =>
    expect(presentations().slice(-1)[0]?.point).toMatchObject({
      x: 640,
      y: 360,
      displayId: 1,
      label: "click Commit",
    }),
  );
  view.unmount();
});

it("reads the continuation, not the request, when a spoken task asks to see the screen", async () => {
  const view = await mounted();
  emit("shortcut", { turn: 2, held: true });
  emit("recorded", { turn: 2, durationMs: 1000 });
  admits("asked");
  await act(async () => {
    await mocks.conversationOptions!.tool(
      {
        name: "start_task",
        callId: "task",
        key: "voice-1:task",
        instruction: "what's this error?",
        invocationId: "",
      },
      "conversation",
    );
  });
  act(() =>
    mocks.conversationOptions!.onDone({
      id: "voice-1",
      prompt: "what's this error?",
      reply: "let me look.",
      interrupted: false,
    }),
  );
  complete("asked", "Let me look at your screen.", {
    screenRequest: {
      kind: "look",
      reason: "see the error",
      location: "separate",
      state: "pending",
    },
  });
  expect(mocks.speech).not.toHaveBeenCalled();
  captureScreens();
  admits("continued");
  await act(async () =>
    useCompanionState.getState().submit!({
      prompt: "Continue the request above. The user's screen is attached as an image.",
      conversationId: "conversation",
      look: true,
      continuation: true,
    }),
  );
  // The spoken conversation stays open to read the continuation's answer.
  expect(mocks.conversationClose).not.toHaveBeenCalled();
  complete("continued", "that's a missing import. [POINT:100,200:the import line:screen1]");
  await waitFor(() => expect(mocks.speech).toHaveBeenCalledWith("continued"));
  expect(mocks.speech).not.toHaveBeenCalledWith("asked");
  view.unmount();
});

it("holds a walkthrough step until its target is clicked, then asks for the next step", async () => {
  captureScreens();
  const view = await mounted();
  admits("step-1");
  await act(async () =>
    useCompanionState.getState().submit!({
      prompt: "teach me to commit",
      conversationId: "conversation",
      look: true,
      intent: "teach",
    }),
  );
  expect(mocks.submit.mock.calls[0][6]).toMatchObject({
    intent: "teach",
    displayCaptures: [screen],
  });
  complete(
    "step-1",
    "first open the source control menu. [POINT:100,50:open Source Control:screen1] [GUIDE:1/3]",
  );
  await waitFor(() =>
    expect(presentations().slice(-1)[0]?.point).toMatchObject({
      label: "open Source Control",
      guide: { step: 1, total: 3 },
      awaitingClick: true,
    }),
  );
  const watch = mocks.invoke.mock.calls.find(
    ([name, args]) => name === "cursor_companion_watch_clicks" && args.watching,
  );
  expect(watch).toBeDefined();
  const turn = watch![1].turn as number;
  emit("click", { turn, x: 400, y: 400 });
  expect(mocks.submit).toHaveBeenCalledOnce();
  admits("step-2");
  await act(async () => {
    emit("click", { turn, x: 104, y: 47 });
  });
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
  expect(mocks.submit.mock.calls[1][0]).toContain("I did step 1 of 3 (open Source Control)");
  expect(mocks.submit.mock.calls[1][6]).toMatchObject({
    intent: "teach",
    continuation: true,
    displayCaptures: [screen],
  });
  expect(mocks.invoke).toHaveBeenCalledWith("cursor_companion_watch_clicks", {
    turn,
    watching: false,
  });
  view.unmount();
});

it("snaps a point to the control Accessibility finds", async () => {
  captureScreens();
  const base = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation(async (name: string, args: Record<string, unknown>) =>
    name === "cursor_companion_snap"
      ? { x: 120, y: 60, frame: { x: 90, y: 48, width: 60, height: 24 } }
      : base(name, args),
  );
  const view = await mounted();
  admits("snap");
  await act(async () =>
    useCompanionState.getState().submit!({
      prompt: "where's commit?",
      conversationId: "conversation",
      look: true,
      intent: "teach",
    }),
  );
  complete("snap", "right there. [POINT:112,58:click Commit:screen1]");
  await waitFor(() =>
    expect(presentations().slice(-1)[0]?.point).toMatchObject({
      x: 120,
      y: 60,
      frame: { x: 90, y: 48, width: 60, height: 24 },
    }),
  );
  expect(mocks.invoke).toHaveBeenCalledWith("cursor_companion_snap", {
    x: expect.closeTo(112),
    y: expect.closeTo(58),
    label: "click Commit",
  });
  expect(mocks.invoke).not.toHaveBeenCalledWith(
    "cursor_companion_capture_region",
    expect.anything(),
  );
  view.unmount();
});
