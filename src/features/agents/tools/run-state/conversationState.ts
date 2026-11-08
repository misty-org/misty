import type {
  AgentChecklist,
  AgentGoal,
  AgentPlan,
  AgentPlanVersion,
  AgentQuestionSet,
  ConversationCollaboration,
  ConversationMode,
  PermissionMode,
} from "../../plans/planTypes";
import { changeDocument, readDocument } from "./documents";

/** A question set as stored: what the chat sees, plus what only the wait needs. */
export interface StoredQuestionSet extends AgentQuestionSet {
  callId: string;
  /** Its answer went to a new turn, so the asking run must not use it too. */
  continued: boolean;
  /** No run is still waiting after this. */
  waitUntil: string;
}

export interface StoredGoal extends AgentGoal {
  lastInvocationId: string;
  /** A continuation was started and hasn't finished: it must report, or the goal pauses. */
  continuing: boolean;
}

/** Everything one chat holds about its runs, as one document so a change to it is one step. */
export interface ConversationState {
  id: string;
  mode: ConversationMode;
  permissionMode: PermissionMode | "";
  /** Newest version first. */
  plans: AgentPlan[];
  planVersion: number;
  /** The latest goal that wasn't cleared. */
  goal: StoredGoal | null;
  /** Newest first. */
  questionSets: StoredQuestionSet[];
  /** Every run's checklist, newest first. */
  checklists: AgentChecklist[];
}

export const blankConversationState = (id: string): ConversationState => ({
  id,
  mode: "act",
  permissionMode: "",
  plans: [],
  planVersion: 0,
  goal: null,
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

/** Whether a chat has anything saved, so a chat that hasn't started keeps its draft modes. */
export const conversationStateExists = async (account: string, id: string) =>
  readDocument<ConversationState | null>(account, "collaboration", id, () => null).then(Boolean);

export const nowText = (now: number) => new Date(now).toISOString();

export function publicQuestionSet(set: StoredQuestionSet): AgentQuestionSet {
  const { callId: _callId, continued: _continued, waitUntil: _waitUntil, ...shown } = set;
  return shown;
}

export function publicGoal(goal: StoredGoal): AgentGoal {
  const { lastInvocationId: _last, continuing: _continuing, ...shown } = goal;
  return shown;
}

/** The latest top-level run's checklist and those of the runs it delegated to, parent first. */
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

/** What a chat shows when it opens. */
export function collaborationOf(state: ConversationState, now: number): ConversationCollaboration {
  return {
    mode: state.mode,
    permissionMode: state.permissionMode,
    // The agent's default isn't kept here: the composer already has it from the agent itself.
    agentPermissionMode: "",
    checklists: shownChecklists(state.checklists),
    plan: state.plans[0] ?? null,
    planHistory: planHistory(state.plans),
    goal: state.goal ? publicGoal(state.goal) : null,
    questionSets: state.questionSets
      .slice(0, 10)
      .map((set) =>
        publicQuestionSet(
          set.state === "pending" && Date.parse(set.expiresAt) <= now
            ? { ...set, state: "expired" }
            : set,
        ),
      ),
    // Nothing starts a run on its own behind this computer's back: goal turns start here.
    runningInvocationId: "",
  };
}
