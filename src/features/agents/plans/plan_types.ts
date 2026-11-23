export type ConversationMode = "act" | "plan" | "teach";

export type PermissionMode = string;

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
  handedOff: boolean;
  createdAt: string;
  answeredAt?: string;
  expiresAt: string;
}

export type PlanRisk = "read" | "write" | "draft" | "consequential" | "dangerous";
export type PlanStepStatus = "pending" | "in_progress" | "done" | "skipped" | "blocked";

export interface ChecklistItem {
  id: string;
  title: string;
  status: PlanStepStatus;
  note?: string;
  delegated?: boolean;
}

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
  permissionMode: PermissionMode | "";
  agentPermissionMode: PermissionMode | "";
  checklists: AgentChecklist[];
  plan: AgentPlan | null;
  planHistory: AgentPlanVersion[];
  questionSets: AgentQuestionSet[];
  runningInvocationId: string;
}

export type CollaborationEvent =
  | { type: "question.requested" | "question.answered"; questionSet: AgentQuestionSet }
  | { type: "plan.proposed" | "plan.updated"; plan: AgentPlan }
  | { type: "checklist.updated"; checklist: AgentChecklist };

export const collaborationEventTypes = new Set([
  "question.requested",
  "question.answered",
  "plan.proposed",
  "plan.updated",
  "checklist.updated",
]);
