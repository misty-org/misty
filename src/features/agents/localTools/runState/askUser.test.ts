import type * as Actual1 from "@/shared/platform/tauri";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => {
  const { fakeInvoke } = await import("./fakeMistyDb.test-support");
  return { invoke: fakeInvoke };
});
vi.mock("@/shared/platform/tauri", async (actual) => ({
  ...(await actual<typeof Actual1>()),
  hasTauriInternals: () => true,
}));
const published = vi.hoisted(() => [] as { runId: string; event: { type: string } }[]);
vi.mock("@/features/ai-surface/localRunEvents", () => ({
  publishLocalRunEvent: (runId: string, event: { type: string }) =>
    published.push({ runId, event }),
}));

import { localCollaborationApi } from "@/features/agents/collaboration/localApi";
import { LocalToolRejected } from "../host";
import { runStateTools } from "../runStateTools";
import { changeConversationState, readConversationState } from "./conversationState";
import { setRunStateAccount } from "./documents";
import { rows } from "./fakeMistyDb.test-support";
import { forgetKnownRunsForTests, noteRunOwner as rememberRun } from "../runContexts";

const call = (
  name: string,
  input: unknown,
  {
    callId = crypto.randomUUID() as string,
    runId = "run",
    signal = new AbortController().signal,
  } = {},
) =>
  runStateTools[name]!({
    runId,
    callId,
    name,
    input: input as Record<string, unknown>,
    signal,
  }) as Promise<Record<string, unknown>>;

const events = () => published.map((item) => item.event.type);
const state = () => readConversationState("me", "chat");

const refusal = async (work: Promise<unknown>) => {
  const error = (await work.then(
    () => undefined,
    (failure: unknown) => failure,
  )) as LocalToolRejected | undefined;
  expect(error).toBeInstanceOf(LocalToolRejected);
  return error!.message;
};

const questions = [
  {
    header: "Scope",
    question: "Which week?",
    options: [{ label: "This one" }, { label: "Next one", description: "Later" }],
  },
];
beforeEach(async () => {
  rows.clear();
  published.length = 0;
  forgetKnownRunsForTests();
  setRunStateAccount("me");
  await rememberRun("run", { account: "me", conversationId: "chat" });
});
afterEach(() => vi.useRealTimers());

describe("conversation.ask_user", () => {
  const answerAtOnce = async () => {
    await vi.advanceTimersByTimeAsync(1);
    return (await state()).questionSets[0]!;
  };

  beforeEach(() => vi.useFakeTimers());

  it("holds the call until the answer, and tells the chat both ways", async () => {
    const asked = call("conversation.ask_user", { questions });
    const set = await answerAtOnce();
    expect(set.state).toBe("pending");
    expect(events()).toEqual(["question.requested"]);
    let settled = false;
    void asked.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(settled).toBe(false);
    const { continuation, questionSet } = await localCollaborationApi.answer(
      set.id,
      [{ selected: ["This one"] }],
      "chat",
    );
    expect(continuation).toBeUndefined();
    expect(questionSet.state).toBe("answered");
    expect(events()).toEqual(["question.requested", "question.answered"]);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(asked).resolves.toEqual({
      status: "answered",
      answers: [{ header: "Scope", question: "Which week?", selected: ["This one"], other: "" }],
      note: expect.stringContaining("untrusted"),
    });
  });

  it("hands off after the server's 45 seconds, and the answer then continues the chat once", async () => {
    const asked = call("conversation.ask_user", { questions });
    const set = await answerAtOnce();
    await vi.advanceTimersByTimeAsync(45_000);
    await expect(asked).resolves.toMatchObject({ status: "awaiting_answer", question_set: set.id });
    expect((await state()).questionSets[0]).toMatchObject({ state: "pending", handedOff: true });
    const answered = await localCollaborationApi.answer(
      set.id,
      [{ selected: ["Next one"], other: "and the week after" }],
      "chat",
    );
    expect(answered.continuation?.prompt).toBe(
      "My answers to your questions:\n- Scope: Next one; and the week after\n\nContinue the request above with these answers.",
    );
    // Accepted once: answering again is refused, so no second turn can start.
    await expect(
      localCollaborationApi.answer(set.id, [{ selected: ["Next one"] }], "chat"),
    ).rejects.toThrow();
  });

  it("never uses an answer twice when the wait and the answer cross", async () => {
    const asked = call("conversation.ask_user", { questions });
    const set = await answerAtOnce();
    // The answer lands just as the hold runs out: the hand-off finds it answered.
    await vi.advanceTimersByTimeAsync(44_000);
    await localCollaborationApi.answer(set.id, [{ selected: ["This one"] }], "chat");
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(asked).resolves.toMatchObject({ status: "answered" });
    expect((await state()).questionSets[0]).toMatchObject({ continued: false });
  });

  it("stands down when the answer already started a new turn", async () => {
    const asked = call("conversation.ask_user", { questions });
    await answerAtOnce();
    await changeConversationState("me", "chat", (current) => ({
      next: {
        ...current,
        questionSets: current.questionSets.map((set) => ({
          ...set,
          state: "answered" as const,
          continued: true,
        })),
      },
      result: undefined,
    }));
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(asked).resolves.toMatchObject({ status: "awaiting_answer" });
  });

  it("reads a new message as skipping the questions", async () => {
    const asked = call("conversation.ask_user", { questions });
    await answerAtOnce();
    await changeConversationState("me", "chat", (current) => ({
      next: {
        ...current,
        questionSets: current.questionSets.map((set) => ({
          ...set,
          state: "superseded" as const,
        })),
      },
      result: undefined,
    }));
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(asked).resolves.toMatchObject({ status: "skipped" });
  });

  it("closes the question with a cancelled run, and keeps it when the window closes", async () => {
    const stop = new AbortController();
    const asked = call("conversation.ask_user", { questions }, { signal: stop.signal });
    await answerAtOnce();
    stop.abort(new Error("agent_tool_cancelled"));
    expect(await refusal(asked)).toContain("stopped");
    expect((await state()).questionSets[0]!.state).toBe("canceled");

    const closing = new AbortController();
    const again = call("conversation.ask_user", { questions }, { signal: closing.signal });
    await vi.advanceTimersByTimeAsync(1);
    closing.abort(new Error("agent_tool_host_closed"));
    await expect(again).resolves.toMatchObject({ status: "awaiting_answer" });
    expect((await state()).questionSets[0]).toMatchObject({ state: "pending", handedOff: true });
  });

  it("after a restart the card still works: nobody is waiting, so the answer continues the chat", async () => {
    // A set saved mid-wait by an earlier launch: never handed off, its hold not yet up.
    const now = Date.now();
    await changeConversationState("me", "chat", (current) => ({
      next: {
        ...current,
        questionSets: [
          {
            id: "question_old",
            runId: "run",
            callId: "c",
            conversationId: "chat",
            questions: [
              {
                header: "Scope",
                question: "Which?",
                multiSelect: false,
                options: [{ label: "A" }, { label: "B" }],
              },
            ],
            state: "pending" as const,
            handedOff: false,
            continued: false,
            createdAt: new Date(performance.timeOrigin - 1000).toISOString(),
            waitUntil: new Date(now + 30_000).toISOString(),
            expiresAt: new Date(now + 86_400_000).toISOString(),
          },
        ],
      },
      result: undefined,
    }));
    const result = await localCollaborationApi.answer(
      "question_old",
      [{ selected: ["A"] }],
      "chat",
    );
    expect(result.continuation?.prompt).toContain("- Scope: A");
  });

  it("repeating a call reuses its set and shows nothing new; a new call replaces the open one", async () => {
    const first = call("conversation.ask_user", { questions }, { callId: "one" });
    await answerAtOnce();
    const repeat = call("conversation.ask_user", { questions }, { callId: "one" });
    await vi.advanceTimersByTimeAsync(1);
    expect((await state()).questionSets).toHaveLength(1);
    expect(events()).toEqual(["question.requested"]);
    const second = call("conversation.ask_user", { questions }, { callId: "two" });
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await state()).questionSets.map((set) => set.state)).toEqual(["pending", "superseded"]);
    await expect(first).resolves.toMatchObject({ status: "skipped" });
    await expect(repeat).resolves.toMatchObject({ status: "skipped" });
    await vi.advanceTimersByTimeAsync(45_000);
    await expect(second).resolves.toMatchObject({ status: "awaiting_answer" });
  });
});

describe("conversation.ask_user refuses", () => {
  it("a question that only asks for a go-ahead, as a result the model reads", async () => {
    await expect(
      call("conversation.ask_user", {
        questions: [
          {
            header: "Post",
            question: "Post it?",
            options: [{ label: "Yes, post it" }, { label: "Revise first" }],
          },
        ],
      }),
    ).resolves.toMatchObject({ status: "failure", tool_error: { message: expect.any(String) } });
    expect(rows.has("me/collaboration/chat")).toBe(false);
  });

  it("anything outside the limits", async () => {
    const options = [{ label: "A" }, { label: "B" }];
    for (const bad of [
      { questions: [] },
      { questions: Array(5).fill({ header: "H", question: "Q", options }) },
      { questions: [{ header: "x".repeat(25), question: "Q", options }] },
      { questions: [{ header: "H", question: "Q", options: [{ label: "A" }] }] },
      { questions: [{ header: "H", question: "Q", options, extra: true }] },
    ])
      expect(await refusal(call("conversation.ask_user", bad))).toContain("input schema");
    for (const bad of [
      [{ label: "A" }, { label: "a" }],
      [{ label: "A" }, { label: "Other" }],
    ])
      expect(
        await refusal(
          call("conversation.ask_user", {
            questions: [{ header: "H", question: "Q", options: bad }],
          }),
        ),
      ).toContain("Do not add an Other option");
  });

  it("a run outside any chat, or one nobody noted", async () => {
    await rememberRun("loose", { account: "me", conversationId: "" });
    expect(
      await refusal(call("conversation.ask_user", { questions }, { runId: "loose" })),
    ).toContain("no conversation");
    vi.useFakeTimers();
    const unknown = refusal(call("log.work.read", {}, { runId: "unknown" }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await unknown).toContain("which chat");
  });
});
