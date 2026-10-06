/** Plan mode researches and proposes; Act mode does the work. */
export type ConversationMode = "act" | "plan";

export interface AgentQuestionOption {
  label: string;
  description?: string;
}

export interface AgentQuestion {
  header: string;
  question: string;
  multiSelect: boolean;
  options: AgentQuestionOption[];
}

export interface AgentQuestionAnswer {
  selected: string[];
  other?: string;
}

export interface AgentQuestionSet {
  id: string;
  runId: string;
  conversationId: string;
  questions: AgentQuestion[];
  answers?: AgentQuestionAnswer[];
  state: "pending" | "answered" | "superseded" | "canceled" | "expired";
  /** The asking run stopped waiting; answering continues the conversation. */
  handedOff: boolean;
  createdAt: string;
  answeredAt?: string;
  expiresAt: string;
}

export type PlanRisk = "read" | "write" | "draft" | "consequential" | "dangerous";
export type PlanStepStatus = "pending" | "in_progress" | "done" | "skipped" | "blocked";

export interface AgentPlanStep {
  id: string;
  title: string;
  detail?: string;
  tools?: string[] | null;
  risk: PlanRisk;
}

export interface AgentPlanPayload {
  title: string;
  summary: string;
  steps: AgentPlanStep[];
  assumptions: string[] | null;
  successCriteria: string[] | null;
}

export interface AgentPlan {
  id: string;
  conversationId: string;
  version: number;
  runId?: string;
  author: "agent" | "user";
  plan: AgentPlanPayload;
  progress: Record<string, { status: PlanStepStatus; note?: string; updatedAt: string }>;
  state: "proposed" | "approved" | "superseded" | "rejected" | "completed";
  createdAt: string;
  approvedAt?: string;
  updatedAt: string;
}

export type GoalStatus =
  "pursuing" | "paused" | "achieved" | "unmet" | "budget_limited" | "cleared";

export interface GoalReport {
  status: string;
  summary: string;
  evidence?: Array<{ criterion: string; proof: string }> | null;
  next_steps?: string[] | null;
  reported_at?: string;
}

export interface AgentGoal {
  id: string;
  conversationId: string;
  objective: string;
  successCriteria: string[];
  status: GoalStatus;
  budgetTokens: number;
  usedTokens: number;
  continuationCount: number;
  maxContinuations: number;
  lastReport?: GoalReport | null;
  createdAt: string;
  updatedAt: string;
}

/** One version of a conversation's plan, for its history. */
export interface AgentPlanVersion {
  id: string;
  version: number;
  author: "agent" | "user";
  title: string;
  state: AgentPlan["state"];
  createdAt: string;
}

export interface ConversationCollaboration {
  mode: ConversationMode;
  plan: AgentPlan | null;
  /** Every version of the plan, newest first. */
  planHistory: AgentPlanVersion[];
  goal: AgentGoal | null;
  questionSets: AgentQuestionSet[];
  /** A run the server started on its own, such as a goal continuation. */
  runningInvocationId: string;
}

/** Collaboration updates in an invocation's event stream. */
export type CollaborationEvent =
  | { type: "question.requested" | "question.answered"; questionSet: AgentQuestionSet }
  | { type: "plan.proposed" | "plan.updated"; plan: AgentPlan }
  | { type: "goal.updated"; goal: AgentGoal };

export const collaborationEventTypes = new Set([
  "question.requested",
  "question.answered",
  "plan.proposed",
  "plan.updated",
  "goal.updated",
]);
