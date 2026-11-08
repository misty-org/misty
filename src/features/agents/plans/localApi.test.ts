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
import { openQuestionSet, validateAnswers } from "@/features/agents/tools/run-state/questions";
import { proposePlan } from "@/features/agents/tools/run-state/plans";
import { localCollaborationApi as api } from "./localApi";
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

beforeEach(() => {
  rows.clear();
  published.length = 0;
  setRunStateAccount("me");
});

describe("plans", () => {
  it("approve takes the exact version, moves the chat to Act, and gives the turn that runs it", async () => {
    await api.setMode("chat", "plan");
    const plan = await propose();
    await expect(api.approvePlan({ ...plan, version: 9 })).rejects.toThrow();
    const approved = await api.approvePlan(plan);
    expect(approved).toMatchObject({
      mode: "act",
      prompt: "Run the approved plan “Tidy”.",
      plan: { state: "approved", approvedAt: expect.any(String) },
    });
    expect((await readConversationState("me", "chat")).mode).toBe("act");
    // Only a proposed plan can be approved or rejected.
    await expect(api.approvePlan(plan)).rejects.toThrow();
    await expect(api.rejectPlan(plan)).rejects.toThrow();
  });

  it("revise is the person's new version, only over the plan still on offer", async () => {
    const plan = await propose();
    const { plan: revised } = await api.revisePlan(plan, { ...payload, title: "Tidy more" });
    expect(revised).toMatchObject({ version: 2, author: "user", state: "proposed" });
    expect(revised.runId).toBeUndefined();
    await expect(api.revisePlan(plan, payload)).rejects.toThrow();
    await expect(api.revisePlan(revised, { ...payload, steps: [] })).rejects.toThrow();
  });

  it("reject sets a plan aside, and history lists every version newest first", async () => {
    const plan = await propose();
    const { plan: rejected } = await api.rejectPlan(plan);
    expect(rejected.state).toBe("rejected");
    await propose("run", "Second");
    const shown = await api.get("chat");
    expect(shown.plan?.plan.title).toBe("Second");
    expect(shown.planHistory.map((item) => [item.version, item.state])).toEqual([
      [2, "proposed"],
      [1, "rejected"],
    ]);
  });
});

describe("questions", () => {
  const open = () =>
    changeConversationState("me", "chat", (state) =>
      openQuestionSet(state, {
        id: "q1",
        runId: "run",
        callId: "c1",
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

  it("only offered labels, one unless multi-select, and something for every question", async () => {
    const [question] = [
      { header: "H", question: "Q", multiSelect: false, options: [{ label: "A" }, { label: "B" }] },
    ];
    expect(() => validateAnswers([question!], [])).toThrow();
    expect(() => validateAnswers([question!], [{ selected: ["Z"] }])).toThrow();
    expect(() => validateAnswers([question!], [{ selected: ["A", "B"] }])).toThrow();
    expect(() => validateAnswers([question!], [{ selected: [] }])).toThrow();
    expect(() =>
      validateAnswers([question!], [{ selected: [], other: "x".repeat(1001) }]),
    ).toThrow();
    expect(validateAnswers([question!], [{ selected: [], other: " mine " }])).toEqual([
      { selected: [], other: "mine" },
    ]);
    expect(
      validateAnswers([{ ...question!, multiSelect: true }], [{ selected: ["A", "B"] }]),
    ).toEqual([{ selected: ["A", "B"] }]);
  });

  it("an expired question can't be answered, and shows as expired", async () => {
    const { set } = await open();
    await changeConversationState("me", "chat", (state) => ({
      next: {
        ...state,
        questionSets: state.questionSets.map((item) => ({
          ...item,
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        })),
      },
      result: undefined,
    }));
    await expect(api.answer(set.id, [{ selected: ["A"] }], "chat")).rejects.toThrow();
    expect((await api.get("chat")).questionSets[0]).toMatchObject({ state: "expired" });
  });

  it("hides what only the wait needs", async () => {
    const { set } = await open();
    const { questionSet } = await api.answer(set.id, [{ selected: ["A"] }], "chat");
    expect(questionSet).not.toHaveProperty("callId");
    expect(questionSet).not.toHaveProperty("continued");
    expect((await api.get("chat")).questionSets[0]).not.toHaveProperty("waitUntil");
    expect(published.map((event) => event.type)).toEqual(["question.answered"]);
  });
});

describe("opening a chat", () => {
  it("a chat with nothing saved reads as missing, so its draft modes stay", async () => {
    await expect(api.get("new")).rejects.toThrow();
  });

  it("modes persist, and no account means nothing is read or written", async () => {
    await api.setMode("chat", "plan");
    await api.setPermissionMode("chat", "auto");
    expect(await api.get("chat")).toMatchObject({
      mode: "plan",
      permissionMode: "auto",
      runningInvocationId: "",
    });
    await expect(api.setMode("chat", "bad" as never)).rejects.toThrow();
    setRunStateAccount("");
    await expect(api.get("chat")).rejects.toThrow();
  });
});
