import { nowText, type ConversationState, type StoredGoal } from "./conversationState";
import { changeDocument, RunStateError } from "./documents";
import { maxGoalCriteria, trimmedList } from "./plans";

/** Goals a conversation pursues across turns, within a limit. */

const defaultBudgetTokens = 1_500_000;
const minBudgetTokens = 10_000;
const maxBudgetTokens = 50_000_000;
const defaultContinuations = 20;
/** Bounds automatic goal work per account, on top of each goal's own limits. */
const maxDailyContinuations = 100;
const dayMs = 24 * 60 * 60 * 1000;

const runes = (value: string) => [...value].length;

/** Replaces the chat's active goal with a new pursued one. */
export function setGoal(
  state: ConversationState,
  input: {
    id: string;
    objective: string;
    successCriteria: string[];
    budgetTokens?: number;
    now: number;
  },
): { next: ConversationState; result: StoredGoal } {
  const objective = input.objective.trim();
  if (!objective || runes(objective) > 2000) throw new RunStateError("invalid");
  const budgetTokens = input.budgetTokens || defaultBudgetTokens;
  if (budgetTokens < minBudgetTokens || budgetTokens > maxBudgetTokens)
    throw new RunStateError("invalid");
  const at = nowText(input.now);
  const goal: StoredGoal = {
    id: input.id,
    conversationId: state.id,
    objective,
    successCriteria: trimmedList(input.successCriteria, maxGoalCriteria, 400),
    status: "pursuing",
    budgetTokens,
    usedTokens: 0,
    continuationCount: 0,
    maxContinuations: defaultContinuations,
    lastInvocationId: "",
    continuing: false,
    createdAt: at,
    updatedAt: at,
  };
  return { next: { ...state, goal }, result: goal };
}

/** The person's control: pause, resume (with an optional larger budget) or clear. */
export function controlGoal(
  state: ConversationState,
  id: string,
  status: "paused" | "pursuing" | "cleared",
  budget: number,
  now: number,
): { next: ConversationState; result: StoredGoal } {
  if (!["paused", "pursuing", "cleared"].includes(status)) throw new RunStateError("invalid");
  if (budget !== 0 && (budget < minBudgetTokens || budget > maxBudgetTokens))
    throw new RunStateError("invalid");
  const current = state.goal;
  if (!current || current.id !== id) throw new RunStateError("not_found");
  if (current.status === "achieved" && status !== "cleared") throw new RunStateError("conflict");
  const budgetTokens = budget || current.budgetTokens;
  // A goal that ran out of budget needs room to run.
  if (status === "pursuing" && current.usedTokens >= budgetTokens)
    throw new RunStateError("conflict");
  const updated: StoredGoal = {
    ...current,
    status,
    budgetTokens,
    // A resumed goal gets a fresh run of continuations; spent tokens stay.
    continuationCount:
      status === "pursuing" && current.status !== "pursuing" ? 0 : current.continuationCount,
    continuing: status === "pursuing" ? false : current.continuing,
    updatedAt: nowText(now),
  };
  return { next: { ...state, goal: status === "cleared" ? null : updated }, result: updated };
}

interface Evidence {
  criterion: string;
  proof: string;
}

/** Every success criterion has evidence. A goal without criteria needs at least one piece of it. */
export function goalEvidenceComplete(criteria: string[], evidence: Evidence[] | undefined) {
  const normalize = (value: string) => value.trim().split(/\s+/).join(" ").toLowerCase();
  const proven = new Set(
    (evidence ?? []).filter((item) => item.proof.trim()).map((item) => normalize(item.criterion)),
  );
  if (!criteria.length) return proven.size > 0;
  return criteria.every((criterion) => proven.has(normalize(criterion)));
}

const pauseReport = (summary: string, now: number) => ({
  status: "paused",
  summary,
  reported_at: nowText(now),
});

const reportedBy = (goal: StoredGoal, runId: string) =>
  (goal.lastReport as { invocation_id?: string } | null | undefined)?.invocation_id === runId;

export interface FinishedRun {
  runId: string;
  /** It ended normally: not failed and not stopped. */
  completed: boolean;
  voice: boolean;
  /** An app card is waiting on the person. */
  waitingOnPerson: boolean;
}

/**
 * After a run ends: whether the goal goes on, and the next turn's words if so. Once per finished run.
 * The turn's model tokens aren't known here, so `usedTokens` stays where it was until runs end on this
 * computer; `maxContinuations` and the daily limit still bound the work.
 */
export function goalAfterRun(
  state: ConversationState,
  run: FinishedRun,
  now: number,
): { next?: ConversationState; result: string | undefined } {
  const goal = state.goal;
  if (!goal || !["pursuing", "paused"].includes(goal.status) || goal.lastInvocationId === run.runId)
    return { result: undefined };
  const seen: StoredGoal = {
    ...goal,
    lastInvocationId: run.runId,
    continuing: false,
    updatedAt: nowText(now),
  };
  const stop = (updated: StoredGoal = seen) => ({
    next: { ...state, goal: updated },
    result: undefined,
  });
  if (goal.status !== "pursuing" || !run.completed || run.voice) return stop();
  // A continuation that stopped without reporting would loop without evidence of progress.
  if (goal.continuing && !reportedBy(goal, run.runId))
    return stop({
      ...seen,
      status: "paused",
      lastReport: pauseReport(
        "A continuation ended without reporting progress. Resume when you're ready.",
        now,
      ),
    });
  const waiting =
    state.mode !== "act" ||
    run.waitingOnPerson ||
    state.questionSets.some((set) => set.state === "pending" && Date.parse(set.expiresAt) > now) ||
    state.plans[0]?.state === "proposed";
  if (waiting || goal.continuationCount >= goal.maxContinuations) return stop();
  const number = goal.continuationCount + 1;
  return {
    next: { ...state, goal: { ...seen, continuationCount: number, continuing: true } },
    result: `Continue working toward the goal (continuation ${number} of ${goal.maxContinuations}).`,
  };
}

/** Pauses a goal whose next turn can't start, so the person can resume it. */
export function pauseGoal(state: ConversationState, reason: string, now: number) {
  if (state.goal?.status !== "pursuing") return { result: undefined };
  return {
    next: {
      ...state,
      goal: {
        ...state.goal,
        status: "paused" as const,
        lastReport: pauseReport(reason, now),
        updatedAt: nowText(now),
      },
    },
    result: undefined,
  };
}

/** Takes one of the account's automatic goal turns for today, if any are left. */
export function claimDailyContinuation(account: string, now: number): Promise<boolean> {
  const id = "daily-goal-continuations";
  return changeDocument<{ id: string; times: number[] }, boolean>(
    account,
    "collaboration",
    id,
    () => ({ id, times: [] }),
    (current) => {
      const times = (current.times ?? []).filter((time) => now - time < dayMs);
      if (times.length >= maxDailyContinuations) return { result: false };
      return { next: { id, times: [...times, now] }, result: true };
    },
  );
}
