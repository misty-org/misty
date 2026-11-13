import { create } from "zustand";
import { setRunStateAccount } from "../tools/run-state/documents";
import { collaborationApi } from "./api";
import { upsertChecklist } from "./checklists";
import { upsertQuestionSet, withVersion } from "./storeLists";
import type {
  AgentPlan,
  AgentPlanPayload,
  AgentQuestionAnswer,
  AgentQuestionSet,
  CollaborationEvent,
  ConversationCollaboration,
  ConversationMode,
  PermissionMode,
} from "./planTypes";

const empty = (): ConversationCollaboration => ({
  mode: "act",
  permissionMode: "",
  agentPermissionMode: "ask",
  checklists: [],
  plan: null,
  planHistory: [],
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
  /** Ask or Auto for the next new conversation; empty follows its agent. */
  draftPermissionMode: PermissionMode | "";
  setDefaultMode(mode: ConversationMode): void;
  error: string;
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
  /** After a run ends, reloads the chat's state: what the run changed in it. */
  afterRunSettled(conversationId: string): void;
}

const loading = new Map<string, Promise<ConversationCollaboration | undefined>>();
const polls = new Map<string, Array<ReturnType<typeof setTimeout>>>();

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
    draftPermissionMode: "",
    error: "",
    setDefaultMode(mode) {
      if (mode === get().defaultMode) return;
      set({ defaultMode: mode, ...(get().draftChosen ? {} : { draftMode: mode }) });
    },
    setAccount(accountId) {
      if (accountId === get().accountId) return;
      setRunStateAccount(accountId);
      loading.clear();
      for (const timers of polls.values()) timers.forEach((timer) => clearTimeout(timer));
      polls.clear();
      set({
        accountId,
        byConversation: {},
        draftMode: get().defaultMode,
        draftChosen: false,
        draftPermissionMode: "",
        error: "",
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
            checklists: value.checklists ?? [],
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
      patch(conversationId, () => ({
        mode: get().draftMode,
        permissionMode: get().draftPermissionMode,
      }));
      set({ draftMode: get().defaultMode, draftChosen: false, draftPermissionMode: "" });
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
      else if (event.type === "checklist.updated")
        patch(conversationId, (current) => ({
          checklists: upsertChecklist(current.checklists, event.checklist),
        }));
    },
    async answer(questionSet, answers) {
      const accountId = get().accountId;
      const result = await collaborationApi.answer(
        questionSet.id,
        answers,
        questionSet.conversationId,
      );
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
    afterRunSettled(conversationId) {
      if (!conversationId) return;
      void get().load(conversationId);
    },
  };
});

/** The open question set waiting on the user in a conversation, if any. */
export function pendingQuestionSet(state: ConversationCollaboration | undefined) {
  return state?.questionSets.find((set) => set.state === "pending");
}
