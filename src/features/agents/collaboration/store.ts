import { create } from "zustand";
import { collaborationApi } from "./api";
import type {
  AgentGoal,
  AgentPlan,
  AgentPlanPayload,
  AgentQuestionAnswer,
  AgentQuestionSet,
  CollaborationEvent,
  ConversationCollaboration,
  ConversationMode,
} from "./types";

const empty = (): ConversationCollaboration => ({
  mode: "act",
  plan: null,
  planHistory: [],
  goal: null,
  questionSets: [],
  runningInvocationId: "",
});

interface CollaborationStore {
  accountId: string;
  byConversation: Record<string, ConversationCollaboration>;
  /** The mode a new conversation starts in, before it exists on the server. */
  draftMode: ConversationMode;
  /** The account's starting mode for new conversations (Settings → Agents). */
  defaultMode: ConversationMode;
  /** The composer picked a mode for the next new conversation. */
  draftChosen: boolean;
  setDefaultMode(mode: ConversationMode): void;
  error: string;
  /**
   * A turn another surface (the Task drawer) wants sent in a conversation, such
   * as starting or resuming a goal. The open conversation sends it when idle.
   */
  queuedTurn?: { conversationId: string; prompt: string; nonce: number };
  queueTurn(conversationId: string, prompt: string): void;
  takeTurn(nonce: number): void;
  setAccount(accountId: string): void;
  load(conversationId: string): Promise<ConversationCollaboration | undefined>;
  modeFor(conversationId?: string): ConversationMode;
  setMode(conversationId: string | undefined, mode: ConversationMode): Promise<void>;
  /** A new conversation keeps the mode its first message was sent in. */
  adoptDraftMode(conversationId: string): void;
  applyEvent(conversationId: string, event: CollaborationEvent): void;
  answer(set: AgentQuestionSet, answers: AgentQuestionAnswer[]): Promise<string | undefined>;
  approvePlan(plan: AgentPlan): Promise<string>;
  revisePlan(plan: AgentPlan, payload: AgentPlanPayload): Promise<void>;
  rejectPlan(plan: AgentPlan): Promise<void>;
  setGoal(
    conversationId: string,
    input: { objective: string; successCriteria: string[]; budgetTokens?: number },
  ): Promise<string>;
  controlGoal(
    goal: AgentGoal,
    status: "paused" | "pursuing" | "cleared",
    budgetTokens?: number,
  ): Promise<string | undefined>;
  /**
   * After a run ends, looks for the server's goal continuation and attaches to
   * it. `reconnect` reloads conversations and subscribes to running work.
   */
  afterRunSettled(conversationId: string, reconnect: () => void, working: () => boolean): void;
}

const loading = new Map<string, Promise<ConversationCollaboration | undefined>>();
const polls = new Map<string, Array<ReturnType<typeof setTimeout>>>();

/** The plan's history with this version current and earlier ones superseded. */
function withVersion(history: ConversationCollaboration["planHistory"], plan: AgentPlan) {
  const entry = {
    id: plan.id,
    version: plan.version,
    author: plan.author,
    title: plan.plan.title,
    state: plan.state,
    createdAt: plan.createdAt,
  };
  return [
    entry,
    ...history
      .filter((item) => item.id !== plan.id)
      .map((item) =>
        item.version < plan.version && (item.state === "proposed" || item.state === "approved")
          ? { ...item, state: "superseded" as const }
          : item,
      ),
  ].slice(0, 10);
}

function upsertQuestionSet(sets: AgentQuestionSet[], set: AgentQuestionSet) {
  return [set, ...sets.filter((item) => item.id !== set.id)]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 20);
}

export const useCollaborationStore = create<CollaborationStore>((set, get) => {
  const patch = (
    conversationId: string,
    update: (current: ConversationCollaboration) => Partial<ConversationCollaboration>,
  ) =>
    set((state) => {
      const current = state.byConversation[conversationId] ?? empty();
      return {
        byConversation: {
          ...state.byConversation,
          [conversationId]: { ...current, ...update(current) },
        },
      };
    });
  // Answers from an account that has since signed out must not land in the next one.
  const sameAccount = (accountId: string) => get().accountId === accountId;
  return {
    accountId: "",
    byConversation: {},
    draftMode: "act",
    defaultMode: "act",
    draftChosen: false,
    error: "",
    queuedTurn: undefined,
    setDefaultMode(mode) {
      if (mode === get().defaultMode) return;
      set({ defaultMode: mode, ...(get().draftChosen ? {} : { draftMode: mode }) });
    },
    queueTurn(conversationId, prompt) {
      if (conversationId && prompt.trim())
        set({ queuedTurn: { conversationId, prompt, nonce: Date.now() + Math.random() } });
    },
    takeTurn(nonce) {
      if (get().queuedTurn?.nonce === nonce) set({ queuedTurn: undefined });
    },
    setAccount(accountId) {
      if (accountId === get().accountId) return;
      loading.clear();
      for (const timers of polls.values()) timers.forEach((timer) => clearTimeout(timer));
      polls.clear();
      set({
        accountId,
        byConversation: {},
        draftMode: get().defaultMode,
        draftChosen: false,
        error: "",
        queuedTurn: undefined,
      });
    },
    async load(conversationId) {
      if (!conversationId) return undefined;
      const accountId = get().accountId;
      const pending = loading.get(conversationId);
      if (pending) return pending;
      const request = collaborationApi
        .get(conversationId)
        .then((value) => {
          if (!sameAccount(accountId)) return undefined;
          const normalized: ConversationCollaboration = {
            ...empty(),
            ...value,
            questionSets: value.questionSets ?? [],
            planHistory: value.planHistory ?? [],
          };
          set((state) => ({
            byConversation: { ...state.byConversation, [conversationId]: normalized },
          }));
          return normalized;
        })
        .catch(() => undefined)
        .finally(() => loading.delete(conversationId));
      loading.set(conversationId, request);
      return request;
    },
    modeFor(conversationId) {
      if (!conversationId) return get().draftMode;
      return get().byConversation[conversationId]?.mode ?? "act";
    },
    async setMode(conversationId, mode) {
      if (!conversationId) {
        set({ draftMode: mode, draftChosen: true });
        return;
      }
      const previous = get().modeFor(conversationId);
      patch(conversationId, () => ({ mode }));
      try {
        await collaborationApi.setMode(conversationId, mode);
      } catch (error) {
        patch(conversationId, () => ({ mode: previous }));
        set({ error: error instanceof Error ? error.message : "Misty couldn't change the mode." });
      }
    },
    adoptDraftMode(conversationId) {
      if (!conversationId || get().byConversation[conversationId]) return;
      patch(conversationId, () => ({ mode: get().draftMode }));
      set({ draftMode: get().defaultMode, draftChosen: false });
    },
    applyEvent(conversationId, event) {
      if (!conversationId) return;
      if (event.type === "question.requested" || event.type === "question.answered")
        patch(conversationId, (current) => ({
          questionSets: upsertQuestionSet(current.questionSets, event.questionSet),
        }));
      else if (event.type === "plan.proposed" || event.type === "plan.updated")
        patch(conversationId, (current) =>
          current.plan && current.plan.version > event.plan.version
            ? {}
            : { plan: event.plan, planHistory: withVersion(current.planHistory, event.plan) },
        );
      else if (event.type === "goal.updated") patch(conversationId, () => ({ goal: event.goal }));
    },
    async answer(questionSet, answers) {
      const accountId = get().accountId;
      const result = await collaborationApi.answer(questionSet.id, answers);
      if (!sameAccount(accountId)) return undefined;
      patch(questionSet.conversationId, (current) => ({
        questionSets: upsertQuestionSet(current.questionSets, result.questionSet),
      }));
      return result.continuation?.prompt;
    },
    async approvePlan(plan) {
      const result = await collaborationApi.approvePlan(plan);
      patch(plan.conversationId, () => ({ plan: result.plan, mode: result.mode }));
      return result.prompt;
    },
    async revisePlan(plan, payload) {
      const result = await collaborationApi.revisePlan(plan, payload);
      patch(plan.conversationId, (current) => ({
        plan: result.plan,
        planHistory: withVersion(current.planHistory, result.plan),
      }));
    },
    async rejectPlan(plan) {
      const result = await collaborationApi.rejectPlan(plan);
      patch(plan.conversationId, () => ({ plan: result.plan }));
    },
    async setGoal(conversationId, input) {
      const result = await collaborationApi.setGoal(conversationId, input);
      patch(conversationId, () => ({ goal: result.goal }));
      return result.prompt;
    },
    async controlGoal(goal, status, budgetTokens) {
      const result = await collaborationApi.controlGoal(goal, status, budgetTokens);
      patch(goal.conversationId, () => ({ goal: status === "cleared" ? null : result.goal }));
      return result.prompt;
    },
    afterRunSettled(conversationId, reconnect, working) {
      if (!conversationId) return;
      const accountId = get().accountId;
      polls.get(conversationId)?.forEach((timer) => clearTimeout(timer));
      // The server starts a continuation once the finished run settles; look a
      // few times, then stop. Questions and plans also refresh here.
      const timers = [1_500, 4_000, 9_000].map((delay) =>
        setTimeout(() => {
          if (!sameAccount(accountId)) return;
          void get()
            .load(conversationId)
            .then((state) => {
              if (!state || !sameAccount(accountId)) return;
              const stop = () => {
                polls.get(conversationId)?.forEach((timer) => clearTimeout(timer));
                polls.delete(conversationId);
              };
              // Only a pursued goal continues on its own; nothing else to wait for.
              if (state.goal?.status !== "pursuing" && !state.runningInvocationId) return stop();
              if (state.runningInvocationId && !working()) {
                polls.get(conversationId)?.forEach((timer) => clearTimeout(timer));
                polls.delete(conversationId);
                reconnect();
              }
            });
        }, delay),
      );
      polls.set(conversationId, timers);
    },
  };
});

/** The open question set waiting on the user in a conversation, if any. */
export function pendingQuestionSet(state: ConversationCollaboration | undefined) {
  return state?.questionSets.find((set) => set.state === "pending");
}
