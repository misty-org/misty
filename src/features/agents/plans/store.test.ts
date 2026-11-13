import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentPlan, AgentQuestionSet, ConversationCollaboration } from "./planTypes";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  setMode: vi.fn(),
  answer: vi.fn(),
  approvePlan: vi.fn(),
  revisePlan: vi.fn(),
  rejectPlan: vi.fn(),
}));
vi.mock("./api", () => ({ collaborationApi: api }));

import { pendingQuestionSet, useCollaborationStore } from "./store";

const plan = (version: number, state: AgentPlan["state"] = "proposed"): AgentPlan => ({
  id: `plan_${version}`,
  conversationId: "c1",
  version,
  author: "agent",
  plan: {
    title: `Plan ${version}`,
    summary: "",
    steps: [{ id: "s1", title: "Read", risk: "read" }],
    assumptions: [],
    successCriteria: [],
  },
  progress: {},
  state,
  createdAt: `2026-10-06T0${version}:00:00Z`,
  updatedAt: `2026-10-06T0${version}:00:00Z`,
});

const questionSet = (state: AgentQuestionSet["state"]): AgentQuestionSet => ({
  id: "question_1",
  runId: "invocation_1",
  conversationId: "c1",
  questions: [
    {
      header: "Scope",
      question: "Which week?",
      multiSelect: false,
      options: [{ label: "This" }, { label: "Next" }],
    },
  ],
  state,
  handedOff: false,
  createdAt: "2026-10-06T00:00:00Z",
  expiresAt: "2026-10-13T00:00:00Z",
});

const loaded = (overrides: Partial<ConversationCollaboration> = {}): ConversationCollaboration => ({
  mode: "act",
  permissionMode: "",
  agentPermissionMode: "ask",
  checklists: [],
  plan: null,
  planHistory: [],
  questionSets: [],
  runningInvocationId: "",
  ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers();
  Object.values(api).forEach((fn) => fn.mockReset());
  useCollaborationStore.getState().setAccount("");
  useCollaborationStore.getState().setAccount("account");
});
afterEach(() => vi.useRealTimers());

it("keeps a new conversation's mode in the draft until it exists, then follows the account default", async () => {
  const store = useCollaborationStore.getState();
  store.setDefaultMode("plan");
  expect(useCollaborationStore.getState().draftMode).toBe("plan");
  await store.setMode(undefined, "act");
  // An explicit choice beats the default until a conversation adopts it.
  store.setDefaultMode("plan");
  expect(useCollaborationStore.getState().modeFor()).toBe("act");
  store.adoptDraftMode("c1");
  expect(useCollaborationStore.getState().modeFor("c1")).toBe("act");
  expect(useCollaborationStore.getState().draftMode).toBe("plan");
});

it("rolls a mode change back when the server refuses it", async () => {
  api.get.mockResolvedValue(loaded());
  await useCollaborationStore.getState().load("c1");
  api.setMode.mockRejectedValue(new Error("Conversation not found"));
  await useCollaborationStore.getState().setMode("c1", "plan");
  expect(useCollaborationStore.getState().modeFor("c1")).toBe("act");
  expect(useCollaborationStore.getState().error).toBe("Conversation not found");
});

it("applies question and plan events, ignoring a stale plan version", () => {
  const store = useCollaborationStore.getState();
  store.applyEvent("c1", { type: "question.requested", questionSet: questionSet("pending") });
  expect(pendingQuestionSet(useCollaborationStore.getState().byConversation.c1)?.id).toBe(
    "question_1",
  );
  store.applyEvent("c1", { type: "question.answered", questionSet: questionSet("answered") });
  expect(pendingQuestionSet(useCollaborationStore.getState().byConversation.c1)).toBeUndefined();
  store.applyEvent("c1", { type: "plan.proposed", plan: plan(2) });
  store.applyEvent("c1", { type: "plan.proposed", plan: plan(1) });
  const state = useCollaborationStore.getState().byConversation.c1!;
  expect(state.plan?.version).toBe(2);
  expect(state.planHistory.map((item) => item.version)).toEqual([2]);
  store.applyEvent("c1", { type: "plan.proposed", plan: plan(3) });
  expect(
    useCollaborationStore
      .getState()
      .byConversation.c1!.planHistory.map((item) => [item.version, item.state]),
  ).toEqual([
    [3, "proposed"],
    [2, "superseded"],
  ]);
});

it("drops another account's state and answers", async () => {
  useCollaborationStore.getState().applyEvent("c1", { type: "plan.proposed", plan: plan(1) });
  let resolve!: (value: unknown) => void;
  api.answer.mockReturnValue(new Promise((done) => (resolve = done)));
  const answering = useCollaborationStore
    .getState()
    .answer(questionSet("pending"), [{ selected: ["This"] }]);
  useCollaborationStore.getState().setAccount("other");
  resolve({ questionSet: questionSet("answered"), continuation: { prompt: "My answers" } });
  expect(await answering).toBeUndefined();
  expect(useCollaborationStore.getState().byConversation).toEqual({});
});
