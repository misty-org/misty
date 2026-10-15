/** Plan mode researches and proposes; otherwise the agent does the work. */
export type ConversationMode = "act" | "plan";

/**
 * Ask pauses before every action that changes something; Auto continues when a
 * remembered approval covers the action. A chat follows its agent's default
 * until it picks one.
 */
export type PermissionMode = "ask" | "auto";

interface AgentQuestionOption {
  label: string;
  description?: string;
}

interface AgentQuestion {
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

/** One step of a run's live checklist; delegated steps nest another run's checklist. */
export interface ChecklistItem {
  id: string;
  title: string;
  status: PlanStepStatus;
  note?: string;
  delegated?: boolean;
}

/** The live checklist one run published. Newer versions replace older ones. */
export interface AgentChecklist {
  invocationId: string;
  conversationId: string;
  parentInvocationId?: string;
  items: ChecklistItem[];
  version: number;
  updatedAt: string;
}

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

type GoalStatus = "pursuing" | "paused" | "achieved" | "unmet" | "budget_limited" | "cleared";

interface GoalReport {
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
  /** The chat's own Ask or Auto; empty follows the agent. */
  permissionMode: PermissionMode | "";
  /** The agent's default, used while the chat has none of its own. */
  agentPermissionMode: PermissionMode;
  /** The latest run's live checklist and those of the runs it delegated to. */
  checklists: AgentChecklist[];
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
  | { type: "goal.updated"; goal: AgentGoal }
  | { type: "checklist.updated"; checklist: AgentChecklist };

export const collaborationEventTypes = new Set([
  "question.requested",
  "question.answered",
  "plan.proposed",
  "plan.updated",
  "goal.updated",
  "checklist.updated",
]);
