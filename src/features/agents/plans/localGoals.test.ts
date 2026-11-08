import type * as Actual1 from "@/shared/platform/tauri";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => {
  const { fakeInvoke } = await import("@/features/agents/tools/run-state/fakeMistyDb.test-support");
  return { invoke: fakeInvoke };
});
vi.mock("@/shared/platform/tauri", async (actual) => ({
  ...(await actual<typeof Actual1>()),
  hasTauriInternals: () => true,
}));
const published = vi.hoisted(() => [] as { type: string }[]);
vi.mock("@/features/agents/runs/local-run/localRunEvents", () => ({
  publishLocalRunEvent: (_run: string, event: { type: string }) => published.push(event),
}));

import {
  changeConversationState,
  readConversationState,
} from "@/features/agents/tools/run-state/conversationState";
import { setRunStateAccount } from "@/features/agents/tools/run-state/documents";
import { rows } from "@/features/agents/tools/run-state/fakeMistyDb.test-support";
import { goalAfterRun } from "@/features/agents/tools/run-state/goals";
import { proposePlan } from "@/features/agents/tools/run-state/plans";
import { continueGoalAfterRun, localCollaborationApi as api } from "./localApi";
import type { AgentPlan, AgentPlanPayload } from "./planTypes";

const payload: AgentPlanPayload = {
  title: "Tidy",
  summary: "Steps",
  steps: [{ id: "a", title: "Read", risk: "read" }],
  assumptions: [],
  successCriteria: [],
};

const propose = (runId = "run", title = "Tidy"): Promise<AgentPlan> =>
  changeConversationState("me", "chat", (state) =>
    proposePlan(state, {
      id: `plan_${title}`,
      runId,
      author: "agent",
      payload: { ...payload, title },
      now: Date.now(),
    }),
  );

const finished = (runId: string, extra = {}) => ({
  runId,
  completed: true,
  waitingOnPerson: false,
  ...extra,
});

beforeEach(() => {
  rows.clear();
  published.length = 0;
  setRunStateAccount("me");
});

describe("goals", () => {
  const goal = () =>
    api.setGoal("chat", { objective: " Ship it ", successCriteria: [" Works ", " "] });

  it("sets a pursued goal with the server's defaults and limits", async () => {
    const { goal: set, prompt } = await goal();
    expect(prompt).toBe("Start working toward the goal: Ship it");
    expect(set).toMatchObject({
      objective: "Ship it",
      successCriteria: ["Works"],
      status: "pursuing",
      budgetTokens: 1_500_000,
      maxContinuations: 20,
    });
    await expect(api.setGoal("chat", { objective: " ", successCriteria: [] })).rejects.toThrow();
    await expect(
      api.setGoal("chat", { objective: "x", successCriteria: [], budgetTokens: 5 }),
    ).rejects.toThrow();
  });

  it("pauses, resumes with a fresh run of continuations, and clears", async () => {
    const { goal: set } = await goal();
    await continueGoalAfterRun("me", "chat", finished("r1"));
    const { goal: paused, prompt: none } = await api.controlGoal(set, "paused");
    expect(paused.status).toBe("paused");
    expect(none).toBeUndefined();
    const { goal: resumed, prompt } = await api.controlGoal(set, "pursuing", 2_000_000);
    expect(prompt).toBe("Resume working toward the goal: Ship it");
    expect(resumed).toMatchObject({ continuationCount: 0, budgetTokens: 2_000_000 });
    await expect(api.controlGoal(set, "pursuing", 5)).rejects.toThrow();
    await api.controlGoal(set, "cleared");
    expect((await api.get("chat")).goal).toBeNull();
    await expect(api.controlGoal(set, "paused")).rejects.toThrow();
  });

  it("an achieved goal can only be cleared", async () => {
    const { goal: set } = await goal();
    await changeConversationState("me", "chat", (state) => ({
      next: { ...state, goal: { ...state.goal!, status: "achieved" as const } },
      result: undefined,
    }));
    await expect(api.controlGoal(set, "pursuing")).rejects.toThrow();
    await expect(api.controlGoal(set, "cleared")).resolves.toBeDefined();
  });
});

describe("a goal after a run", () => {
  const report = (runId: string) =>
    changeConversationState("me", "chat", (state) => ({
      next: {
        ...state,
        goal: {
          ...state.goal!,
          lastReport: { status: "in_progress", summary: "s", invocation_id: runId } as never,
        },
      },
      result: undefined,
    }));

  beforeEach(async () => {
    await api.setGoal("chat", { objective: "Ship", successCriteria: [] });
  });

  it("continues once per finished run, however many windows ask", async () => {
    await expect(continueGoalAfterRun("me", "chat", finished("r1"))).resolves.toBe(
      "Continue working toward the goal (continuation 1 of 20).",
    );
    await expect(continueGoalAfterRun("me", "chat", finished("r1"))).resolves.toBeUndefined();
    expect((await readConversationState("me", "chat")).goal?.continuationCount).toBe(1);
  });

  it("a continuation that reports goes on, and one that doesn't pauses the goal", async () => {
    await continueGoalAfterRun("me", "chat", finished("r1"));
    await report("r2");
    await expect(continueGoalAfterRun("me", "chat", finished("r2"))).resolves.toContain(
      "continuation 2 of 20",
    );
    await expect(continueGoalAfterRun("me", "chat", finished("r3"))).resolves.toBeUndefined();
    const { goal } = await readConversationState("me", "chat");
    expect(goal).toMatchObject({
      status: "paused",
      lastReport: { summary: expect.stringContaining("without reporting") },
    });
  });

  it("waits for a stopped run, an open question, a proposed plan, an app card and Plan mode", async () => {
    const quiet = async (run: ReturnType<typeof finished>) =>
      expect(await continueGoalAfterRun("me", "chat", run)).toBeUndefined();
    await quiet(finished("failed", { completed: false }));
    await quiet(finished("card", { waitingOnPerson: true }));
    await api.setMode("chat", "plan");
    await quiet(finished("planning"));
    await api.setMode("chat", "act");
    await propose();
    await quiet(finished("proposed"));
    expect((await readConversationState("me", "chat")).goal?.continuationCount).toBe(0);
  });

  it("not from a spoken turn, nor past the goal's own limit", async () => {
    const state = await readConversationState("me", "chat");
    expect(
      goalAfterRun(
        state,
        { runId: "voice", completed: true, voice: true, waitingOnPerson: false },
        Date.now(),
      ).result,
    ).toBeUndefined();
    expect(
      goalAfterRun(
        { ...state, goal: { ...state.goal!, continuationCount: 20 } },
        { runId: "full", completed: true, voice: false, waitingOnPerson: false },
        Date.now(),
      ).result,
    ).toBeUndefined();
  });

  it("pauses at the account's daily limit", async () => {
    rows.set(
      "me/collaboration/daily-goal-continuations",
      JSON.stringify({
        id: "daily-goal-continuations",
        times: Array.from({ length: 100 }, () => Date.now()),
      }),
    );
    await expect(continueGoalAfterRun("me", "chat", finished("r1"))).resolves.toBeUndefined();
    expect((await readConversationState("me", "chat")).goal?.status).toBe("paused");
  });
});
