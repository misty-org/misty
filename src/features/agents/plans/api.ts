import { localCollaborationApi } from "./local_api";
import type {
  AgentPlan,
  AgentPlanPayload,
  AgentQuestionAnswer,
  AgentQuestionSet,
  ConversationCollaboration,
  ConversationMode,
  PermissionMode,
} from "./plan_types";

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
};
