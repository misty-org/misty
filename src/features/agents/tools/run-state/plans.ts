import type {
  AgentPlan,
  AgentPlanPayload,
  ChecklistItem,
  PlanStepStatus,
} from "../../plans/planTypes";
import { nowText, type ConversationState } from "./conversationState";
import { RunStateError } from "./documents";

/** Plans an agent proposes in Plan mode, their versions and step progress. */

export const maxPlanSteps = 12;
export const maxGoalCriteria = 10;
const keepPlans = 20;

const risks = new Set(["read", "write", "draft", "consequential", "dangerous"]);
const stepStatuses = new Set(["pending", "in_progress", "done", "skipped", "blocked"]);

const runes = (value: string) => [...value].length;
const bytes = (value: string) => new TextEncoder().encode(value).length;
const invalid = () => new RunStateError("invalid");

/** Trims a list and drops blanks, refusing one too long. */
export function trimmedList(values: string[] | null | undefined, most: number, longest: number) {
  const list = values ?? [];
  if (list.length > most) throw invalid();
  return list.flatMap((value) => {
    const text = value.trim();
    if (runes(text) > longest) throw invalid();
    return text ? [text] : [];
  });
}

/** Step ids are unique and stable so progress can follow them; missing ids are assigned in order. */
export function normalizePlan(plan: AgentPlanPayload): AgentPlanPayload {
  const title = plan.title.trim();
  const summary = plan.summary.trim();
  if (
    !title ||
    runes(title) > 160 ||
    runes(summary) > 1200 ||
    plan.steps.length < 1 ||
    plan.steps.length > maxPlanSteps
  )
    throw invalid();
  const assumptions = trimmedList(plan.assumptions, 10, 400);
  const successCriteria = trimmedList(plan.successCriteria, maxGoalCriteria, 400);
  const seen = new Set<string>();
  const steps = plan.steps.map((step, index) => {
    const id = step.id?.trim() || `step-${index + 1}`;
    const stepTitle = step.title.trim();
    const detail = step.detail?.trim() ?? "";
    const risk = (step.risk?.trim() || "read") as AgentPlan["plan"]["steps"][number]["risk"];
    if (
      bytes(id) > 40 ||
      seen.has(id) ||
      !stepTitle ||
      runes(stepTitle) > 120 ||
      runes(detail) > 4000 ||
      !risks.has(risk)
    )
      throw invalid();
    seen.add(id);
    const tools = trimmedList(step.tools, 8, 80);
    return {
      id,
      title: stepTitle,
      ...(detail ? { detail } : {}),
      ...(tools.length ? { tools } : {}),
      risk,
    };
  });
  return { title, summary, steps, assumptions, successCriteria };
}

const replacingPlan = (state: ConversationState, plan: AgentPlan): ConversationState => ({
  ...state,
  plans: state.plans.map((item) => (item.id === plan.id ? plan : item)),
});

/** Saves a new version and supersedes the current one. A repeated proposal from the same run returns it. */
export function proposePlan(
  state: ConversationState,
  input: {
    id: string;
    runId: string;
    author: "agent" | "user";
    payload: AgentPlanPayload;
    now: number;
  },
): { next?: ConversationState; result: AgentPlan } {
  const payload = normalizePlan(input.payload);
  const current = state.plans.find(
    (plan) => plan.state === "proposed" || plan.state === "approved",
  );
  if (
    current &&
    input.author === "agent" &&
    input.runId &&
    current.runId === input.runId &&
    current.state === "proposed" &&
    JSON.stringify(current.plan) === JSON.stringify(payload)
  )
    return { result: current };
  const at = nowText(input.now);
  const planVersion = state.planVersion + 1;
  const plan: AgentPlan = {
    id: input.id,
    conversationId: state.id,
    version: planVersion,
    ...(input.runId ? { runId: input.runId } : {}),
    author: input.author,
    plan: payload,
    progress: {},
    state: "proposed",
    createdAt: at,
    updatedAt: at,
  };
  const earlier = state.plans.map((item) =>
    item.id === current?.id ? { ...item, state: "superseded" as const, updatedAt: at } : item,
  );
  return {
    next: { ...state, planVersion, plans: [plan, ...earlier].slice(0, keepPlans) },
    result: plan,
  };
}

function planById(state: ConversationState, id: string): AgentPlan {
  const plan = state.plans.find((item) => item.id === id);
  if (!plan) throw new RunStateError("not_found");
  return plan;
}

/** Approves the exact version the person reviewed, and the chat goes back to acting. */
export function approvePlan(
  state: ConversationState,
  id: string,
  version: number,
  now: number,
): { next: ConversationState; result: AgentPlan } {
  const plan = planById(state, id);
  if (plan.version !== version || plan.state !== "proposed") throw new RunStateError("conflict");
  const at = nowText(now);
  const approved: AgentPlan = { ...plan, state: "approved", approvedAt: at, updatedAt: at };
  return { next: { ...replacingPlan(state, approved), mode: "act" }, result: approved };
}

/** The person's own edit: a new version, only over the plan still on offer. */
export function revisePlan(
  state: ConversationState,
  input: { id: string; currentId: string; payload: AgentPlanPayload; now: number },
): { next?: ConversationState; result: AgentPlan } {
  const current = planById(state, input.currentId);
  if (current.state !== "proposed" || state.plans[0]?.id !== current.id)
    throw new RunStateError("conflict");
  return proposePlan(state, {
    id: input.id,
    runId: "",
    author: "user",
    payload: input.payload,
    now: input.now,
  });
}

/** Sets a proposed plan aside without running it. */
export function rejectPlan(
  state: ConversationState,
  id: string,
  now: number,
): { next: ConversationState; result: AgentPlan } {
  const plan = planById(state, id);
  if (plan.state !== "proposed") throw new RunStateError("conflict");
  const rejected: AgentPlan = { ...plan, state: "rejected", updatedAt: nowText(now) };
  return { next: replacingPlan(state, rejected), result: rejected };
}

export interface PlanProgressUpdate {
  id: string;
  status: PlanStepStatus;
  note?: string;
}

/** Records step progress on the approved plan. It completes when every step is done or skipped. */
export function updatePlanProgress(
  state: ConversationState,
  updates: PlanProgressUpdate[],
  now: number,
): { next: ConversationState; result: AgentPlan } {
  if (updates.length < 1 || updates.length > maxPlanSteps) throw invalid();
  const plan = state.plans.find((item) => item.state === "approved");
  if (!plan) throw new RunStateError("conflict");
  const steps = new Set(plan.plan.steps.map((step) => step.id));
  const at = nowText(now);
  const progress = { ...plan.progress };
  for (const update of updates) {
    const id = update.id.trim();
    const status = update.status.trim() as PlanStepStatus;
    const note = update.note?.trim() ?? "";
    if (!steps.has(id) || !stepStatuses.has(status) || runes(note) > 500) throw invalid();
    progress[id] = { status, ...(note ? { note } : {}), updatedAt: at };
  }
  const complete = plan.plan.steps.every((step) => {
    const status = progress[step.id]?.status;
    return status === "done" || status === "skipped";
  });
  const updated: AgentPlan = {
    ...plan,
    progress,
    state: complete ? "completed" : "approved",
    updatedAt: at,
  };
  return { next: replacingPlan(state, updated), result: updated };
}

/** What a run following a plan may report on: never while planning. */
export function approvedPlanOf(state: ConversationState): AgentPlan | undefined {
  const plan = state.plans[0];
  return state.mode !== "plan" && plan?.state === "approved" ? plan : undefined;
}

/** An approved plan's steps with their progress, the starting checklist for a run following it. */
export function planChecklistSeed(plan: AgentPlan | undefined): ChecklistItem[] {
  return (plan?.plan.steps ?? []).map((step) => {
    const progress = plan?.progress[step.id];
    return {
      id: step.id,
      title: step.title,
      status: progress?.status ?? "pending",
      ...(progress?.note ? { note: progress.note } : {}),
    };
  });
}
