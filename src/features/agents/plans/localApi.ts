import { publishLocalRunEvent } from "../runs/local-run/localRunEvents";
import type { AiInvocationEvent } from "../runs/invocations/invocationTypes";
import {
  changeConversationState,
  collaborationOf,
  conversationStateExists,
  publicGoal,
  publicQuestionSet,
  readConversationState,
} from "../tools/run-state/conversationState";
import { RunStateError, runStateAccount } from "../tools/run-state/documents";
import {
  claimDailyContinuation,
  controlGoal,
  goalAfterRun,
  pauseGoal,
  setGoal,
  type FinishedRun,
} from "../tools/run-state/goals";
import { approvePlan, rejectPlan, revisePlan } from "../tools/run-state/plans";
import { answerQuestionSet, questionContinuationPrompt } from "../tools/run-state/questions";
import { runContext } from "../tools/runContexts";
import type {
  AgentGoal,
  AgentPlan,
  AgentPlanPayload,
  AgentQuestionAnswer,
  ConversationMode,
  PermissionMode,
} from "./planTypes";

/** The chat's side of a run's state, in misty.db. Answers what the server's routes answered. */

function account(): string {
  const current = runStateAccount();
  if (!current) throw new RunStateError("not_found");
  return current;
}

export const localCollaborationApi = {
  async get(conversationId: string) {
    const owner = account();
    // Like the server's 404: a chat with nothing saved keeps the composer's draft modes.
    if (!(await conversationStateExists(owner, conversationId)))
      throw new RunStateError("not_found");
    return collaborationOf(await readConversationState(owner, conversationId), Date.now());
  },
  async setMode(conversationId: string, mode: ConversationMode) {
    if (!["act", "plan", "teach"].includes(mode)) throw new RunStateError("invalid");
    await changeConversationState(account(), conversationId, (state) => ({
      next: { ...state, mode },
      result: undefined,
    }));
    return { mode };
  },
  async setPermissionMode(conversationId: string, permissionMode: PermissionMode | "") {
    if (!["", "ask", "auto", "bypass"].includes(permissionMode)) throw new RunStateError("invalid");
    await changeConversationState(account(), conversationId, (state) => ({
      next: { ...state, permissionMode },
      result: undefined,
    }));
    return { permissionMode };
  },
  /**
   * While the asking run still waits, it picks the answers up itself and only hears the event. Once
   * nobody is waiting, the answer carries the turn that continues the chat, claimed by this one call.
   */
  async answer(questionSetId: string, answers: AgentQuestionAnswer[], conversationId: string) {
    const set = await changeConversationState(account(), conversationId, (state) =>
      answerQuestionSet(state, questionSetId, answers, Date.now(), performance.timeOrigin),
    );
    const questionSet = publicQuestionSet(set);
    publishLocalRunEvent(set.runId, {
      id: crypto.randomUUID(),
      type: "question.answered",
      questionSet,
    } as AiInvocationEvent);
    return {
      questionSet,
      ...(set.continued ? { continuation: { prompt: questionContinuationPrompt(set) } } : {}),
    };
  },
  async approvePlan(plan: AgentPlan) {
    const approved = await changeConversationState(account(), plan.conversationId, (state) =>
      approvePlan(state, plan.id, plan.version, Date.now()),
    );
    return {
      plan: approved,
      mode: "act" as ConversationMode,
      prompt: `Run the approved plan “${approved.plan.title}”.`,
    };
  },
  async revisePlan(plan: AgentPlan, payload: AgentPlanPayload) {
    const revised = await changeConversationState(account(), plan.conversationId, (state) =>
      revisePlan(state, {
        id: `plan_${crypto.randomUUID()}`,
        currentId: plan.id,
        payload,
        now: Date.now(),
      }),
    );
    return { plan: revised };
  },
  async rejectPlan(plan: AgentPlan) {
    const rejected = await changeConversationState(account(), plan.conversationId, (state) =>
      rejectPlan(state, plan.id, Date.now()),
    );
    return { plan: rejected };
  },
  async setGoal(
    conversationId: string,
    input: { objective: string; successCriteria: string[]; budgetTokens?: number },
  ) {
    const goal = await changeConversationState(account(), conversationId, (state) =>
      setGoal(state, { id: `goal_${crypto.randomUUID()}`, ...input, now: Date.now() }),
    );
    return {
      goal: publicGoal(goal),
      prompt: `Start working toward the goal: ${goal.objective}`,
    };
  },
  async controlGoal(
    goal: AgentGoal,
    status: "paused" | "pursuing" | "cleared",
    budgetTokens?: number,
  ) {
    const updated = await changeConversationState(account(), goal.conversationId, (state) =>
      controlGoal(state, goal.id, status, budgetTokens ?? 0, Date.now()),
    );
    return {
      goal: publicGoal(updated),
      ...(updated.status === "pursuing"
        ? { prompt: `Resume working toward the goal: ${updated.objective}` }
        : {}),
    };
  },
};

/** What a chat knows about a run that just ended. */
export type LocalRunEnd = Omit<FinishedRun, "voice">;

/**
 * Counts a finished run against its chat's goal. Returns the next turn when the goal goes on; any
 * window may ask, and only the first gets it. The server did this when a run completed.
 */
export async function continueGoalAfterRun(
  owner: string,
  conversationId: string,
  run: LocalRunEnd,
): Promise<string | undefined> {
  const context = await runContext(run.runId, 1);
  const prompt = await changeConversationState(owner, conversationId, (state) =>
    goalAfterRun(state, { ...run, voice: Boolean(context?.voice) }, Date.now()),
  );
  if (!prompt) return undefined;
  if (await claimDailyContinuation(owner, Date.now())) return prompt;
  await changeConversationState(owner, conversationId, (state) =>
    pauseGoal(
      state,
      "Misty couldn't start the next step toward the goal. Resume to try again.",
      Date.now(),
    ),
  );
  return undefined;
}
