import { apiRequest } from "@/api/client";
import type {
  AgentGoal,
  AgentPlan,
  AgentPlanPayload,
  AgentQuestionAnswer,
  AgentQuestionSet,
  ConversationCollaboration,
  ConversationMode,
} from "./types";

const segment = encodeURIComponent;

export const collaborationApi = {
  get: (conversationId: string) =>
    apiRequest<ConversationCollaboration>(
      `/me/conversations/${segment(conversationId)}/collaboration`,
      {
        cache: "no-store",
      },
    ),
  setMode: (conversationId: string, mode: ConversationMode) =>
    apiRequest<{ mode: ConversationMode }>(`/me/conversations/${segment(conversationId)}/mode`, {
      method: "PUT",
      body: JSON.stringify({ mode }),
    }),
  answer: (questionSetId: string, answers: AgentQuestionAnswer[]) =>
    apiRequest<{ questionSet: AgentQuestionSet; continuation?: { prompt: string } }>(
      `/me/agent-questions/${segment(questionSetId)}/answer`,
      { method: "POST", body: JSON.stringify({ answers }) },
    ),
  approvePlan: (plan: AgentPlan) =>
    apiRequest<{ plan: AgentPlan; mode: ConversationMode; prompt: string }>(
      `/me/agent-plans/${segment(plan.id)}/approve`,
      { method: "POST", body: JSON.stringify({ version: plan.version }) },
    ),
  revisePlan: (plan: AgentPlan, payload: AgentPlanPayload) =>
    apiRequest<{ plan: AgentPlan }>(`/me/agent-plans/${segment(plan.id)}/revise`, {
      method: "POST",
      body: JSON.stringify({ plan: payload }),
    }),
  rejectPlan: (plan: AgentPlan) =>
    apiRequest<{ plan: AgentPlan }>(`/me/agent-plans/${segment(plan.id)}/reject`, {
      method: "POST",
      body: "{}",
    }),
  setGoal: (
    conversationId: string,
    input: { objective: string; successCriteria: string[]; budgetTokens?: number },
  ) =>
    apiRequest<{ goal: AgentGoal; prompt: string }>(
      `/me/conversations/${segment(conversationId)}/goal`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    ),
  controlGoal: (
    goal: AgentGoal,
    status: "paused" | "pursuing" | "cleared",
    budgetTokens?: number,
  ) =>
    apiRequest<{ goal: AgentGoal; prompt?: string }>(`/me/agent-goals/${segment(goal.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status, budgetTokens: budgetTokens ?? 0 }),
    }),
};
