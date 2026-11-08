import { localCollaborationApi } from "./localApi";
import type {
  AgentGoal,
  AgentPlan,
  AgentPlanPayload,
  AgentQuestionAnswer,
  AgentQuestionSet,
  ConversationCollaboration,
  ConversationMode,
  PermissionMode,
} from "./planTypes";

/** A chat's collaboration state, in misty.db beside the chat. */
export const collaborationApi = {
  get: (conversationId: string): Promise<ConversationCollaboration> =>
    localCollaborationApi.get(conversationId),
  setMode: (conversationId: string, mode: ConversationMode) =>
    localCollaborationApi.setMode(conversationId, mode),
  setPermissionMode: (conversationId: string, permissionMode: PermissionMode | "") =>
    localCollaborationApi.setPermissionMode(conversationId, permissionMode),
  answer: (
    questionSetId: string,
    answers: AgentQuestionAnswer[],
    conversationId: string,
  ): Promise<{ questionSet: AgentQuestionSet; continuation?: { prompt: string } }> =>
    localCollaborationApi.answer(questionSetId, answers, conversationId),
  approvePlan: (plan: AgentPlan) => localCollaborationApi.approvePlan(plan),
  revisePlan: (plan: AgentPlan, payload: AgentPlanPayload) =>
    localCollaborationApi.revisePlan(plan, payload),
  rejectPlan: (plan: AgentPlan) => localCollaborationApi.rejectPlan(plan),
  setGoal: (
    conversationId: string,
    input: { objective: string; successCriteria: string[]; budgetTokens?: number },
  ) => localCollaborationApi.setGoal(conversationId, input),
  controlGoal: (
    goal: AgentGoal,
    status: "paused" | "pursuing" | "cleared",
    budgetTokens?: number,
  ): Promise<{ goal: AgentGoal; prompt?: string }> =>
    localCollaborationApi.controlGoal(goal, status, budgetTokens),
};
