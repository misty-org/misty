import type * as Actual1 from "@/shared/platform/tauri";
import type * as Actual2 from "@/api/client";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => {
  const { fakeInvoke } = await import("@/features/agents/tools/run-state/fakeMistyDb.test-support");
  return { invoke: fakeInvoke };
});
vi.mock("@/shared/platform/tauri", async (actual) => ({
  ...(await actual<typeof Actual1>()),
  hasTauriInternals: () => true,
}));
vi.mock("@/features/agents/runs/local-run/localRunEvents", () => ({
  publishLocalRunEvent: () => undefined,
}));
const client = vi.hoisted(() => ({ apiRequest: vi.fn(), cachedRequest: vi.fn() }));
vi.mock("@/api/client", async (actual) => ({
  ...(await actual<typeof Actual2>()),
  apiRequest: client.apiRequest,
}));
vi.mock("@/api/cache/cached-request", () => ({ cachedRequest: client.cachedRequest }));

import {
  changeConversationState,
  readConversationState,
} from "@/features/agents/tools/run-state/conversationState";
import { rows, settings } from "@/features/agents/tools/run-state/fakeMistyDb.test-support";
import { openQuestionSet } from "@/features/agents/tools/run-state/questions";
import { forgetKnownRunsForTests } from "@/features/agents/tools/runContexts";
import { setGoal } from "@/features/agents/tools/run-state/goals";
import { collaborationApi } from "./api";
import { admitLocalTurn, supersedeRunQuestions } from "./localTurns";
import { turnModes } from "./permissionMode";
import { pendingQuestionSet, useCollaborationStore } from "./store";

const open = (runId = "run") =>
  changeConversationState("me", "chat", (state) =>
    openQuestionSet(state, {
      id: `q-${runId}`,
      runId,
      callId: "c",
      now: Date.now(),
      questions: [
        {
          header: "One",
          question: "Pick",
          multiSelect: false,
          options: [{ label: "A" }, { label: "B" }],
        },
      ],
    }),
  );

beforeEach(() => {
  rows.clear();
  settings.clear();
  client.apiRequest.mockReset();
  client.cachedRequest.mockReset();
  forgetKnownRunsForTests();
  useCollaborationStore.getState().setAccount("");
  useCollaborationStore.getState().setAccount("me");
});

it("reads and writes misty.db, and never the server", async () => {
  await collaborationApi.setMode("chat", "plan");
  await expect(collaborationApi.get("chat")).resolves.toMatchObject({ mode: "plan" });
  expect(client.apiRequest).not.toHaveBeenCalled();
  expect(client.cachedRequest).not.toHaveBeenCalled();
});

it("a typed turn keeps its modes and answers open questions", async () => {
  await open();
  await useCollaborationStore.getState().load("chat");
  expect(pendingQuestionSet(useCollaborationStore.getState().byConversation.chat)).toBeDefined();
  await admitLocalTurn("me", "chat", { mode: "plan", permissionMode: "auto" });
  const state = await readConversationState("me", "chat");
  expect(state).toMatchObject({ mode: "plan", permissionMode: "auto" });
  expect(state.questionSets[0]!.state).toBe("superseded");
  // The card goes at once, without waiting for a reload.
  expect(pendingQuestionSet(useCollaborationStore.getState().byConversation.chat)).toBeUndefined();
});

it("a follow-up answers only its own run's questions", async () => {
  await open("run");
  await open("other");
  await supersedeRunQuestions("me", "chat", "run");
  const { questionSets } = await readConversationState("me", "chat");
  expect(Object.fromEntries(questionSets.map((set) => [set.runId, set.state]))).toEqual({
    run: "superseded",
    other: "pending",
  });
});

it("sends a chat's own Ask or Auto, which only this computer now knows", async () => {
  await collaborationApi.setPermissionMode("chat", "auto");
  await useCollaborationStore.getState().load("chat");
  expect(turnModes("chat", false)).toEqual({ collaborationMode: "act", permissionMode: "auto" });
});

it("a chat with nothing saved keeps the draft mode for its first turn", async () => {
  const store = useCollaborationStore.getState();
  await store.setMode(undefined, "plan");
  await store.load("new");
  expect(useCollaborationStore.getState().byConversation.new).toBeUndefined();
  expect(turnModes("new", true).collaborationMode).toBe("plan");
});

it("after a run the store queues the goal's next turn itself", async () => {
  await changeConversationState("me", "chat", (state) =>
    setGoal(state, { id: "g", objective: "Ship", successCriteria: [], now: Date.now() }),
  );
  useCollaborationStore.getState().afterRunSettled(
    "chat",
    () => undefined,
    () => false,
    { runId: "r1", completed: true, waitingOnPerson: false },
  );
  await vi.waitFor(() =>
    expect(useCollaborationStore.getState().queuedTurn?.prompt).toBe(
      "Continue working toward the goal (continuation 1 of 20).",
    ),
  );
  await vi.waitFor(() =>
    expect(useCollaborationStore.getState().byConversation.chat?.goal?.continuationCount).toBe(1),
  );
});

it("answering through the store passes the continuation on", async () => {
  const { set } = await open();
  await changeConversationState("me", "chat", (state) => ({
    next: {
      ...state,
      questionSets: state.questionSets.map((item) => ({ ...item, handedOff: true })),
    },
    result: undefined,
  }));
  await expect(
    useCollaborationStore.getState().answer(set, [{ selected: ["A"] }]),
  ).resolves.toContain("My answers to your questions:");
});
