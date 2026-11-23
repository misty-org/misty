import type {
  AgentChecklist,
  AgentPlan,
  AgentPlanVersion,
  AgentQuestionSet,
  ConversationCollaboration,
  ConversationMode,
  PermissionMode,
} from "../../plans/plan_types";
import { changeDocument, readDocument } from "./documents";

export interface StoredQuestionSet extends AgentQuestionSet {
  callId: string;
  continued: boolean;
  waitUntil: string;
}

export interface ConversationState {
  id: string;
  mode: ConversationMode;
  permissionMode: PermissionMode | "";
  plans: AgentPlan[];
  planVersion: number;
  questionSets: StoredQuestionSet[];
  checklists: AgentChecklist[];
}

export const blankConversationState = (id: string): ConversationState => ({
  id,
  mode: "act",
  permissionMode: "",
  plans: [],
  planVersion: 0,
  questionSets: [],
  checklists: [],
});

export const readConversationState = (account: string, id: string) =>
  readDocument<ConversationState>(account, "collaboration", id, () => blankConversationState(id));

export const changeConversationState = <R>(
  account: string,
  id: string,
  change: (current: ConversationState) => { next?: ConversationState; result: R },
) =>
  changeDocument<ConversationState, R>(
    account,
    "collaboration",
    id,
    () => blankConversationState(id),
    change,
  );

export const conversationStateExists = async (account: string, id: string) =>
  readDocument<ConversationState | null>(account, "collaboration", id, () => null).then(Boolean);

export const nowText = (now: number) => new Date(now).toISOString();

export function publicQuestionSet(set: StoredQuestionSet): AgentQuestionSet {
  const { callId: _callId, continued: _continued, waitUntil: _waitUntil, ...shown } = set;
  return shown;
}

function shownChecklists(checklists: AgentChecklist[]): AgentChecklist[] {
  const latest = checklists
    .filter((item) => !item.parentInvocationId)
    .reduce<AgentChecklist | undefined>(
      (best, item) => (!best || item.updatedAt > best.updatedAt ? item : best),
      undefined,
    );
  if (!latest) return [];
  const children = checklists
    .filter((item) => item.parentInvocationId === latest.invocationId)
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  return [latest, ...children];
}

function planHistory(plans: AgentPlan[]): AgentPlanVersion[] {
  return plans.slice(0, 10).map((plan) => ({
    id: plan.id,
    version: plan.version,
    author: plan.author,
    title: plan.plan.title,
    state: plan.state,
    createdAt: plan.createdAt,
  }));
}

export function collaborationOf(state: ConversationState, now: number): ConversationCollaboration {
  return {
    mode: state.mode,
    permissionMode: state.permissionMode,
    agentPermissionMode: "",
    checklists: shownChecklists(state.checklists),
    plan: state.plans[0] ?? null,
    planHistory: planHistory(state.plans),
    questionSets: state.questionSets
      .slice(0, 10)
      .map((set) =>
        publicQuestionSet(
          set.state === "pending" && Date.parse(set.expiresAt) <= now
            ? { ...set, state: "expired" }
            : set,
        ),
      ),
    runningInvocationId: "",
  };
}
