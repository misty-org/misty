import { invoke } from "@/native/invoke";
import type { EnginePlanReview } from "../../../runs/invocations/invocationTypes";

/** Answers: question text to the chosen label, the labels of a multi-select, or the person's words. */
export type EngineAnswers = Record<string, string | string[]>;

/** Answers a question card; null dismisses it. */
export const answerEngineQuestion = (
  runId: string,
  requestId: string,
  answers: EngineAnswers | null,
) => invoke<void>("engine_answer_question", { runId, requestId, answers });

export type PlanDecision = "approve" | "request_changes" | "defer";

interface PlanDecided {
  review: EnginePlanReview;
  /** The engine carries the plan out in the turn that is still waiting. */
  native: boolean;
  /** The chat switches to Auto and asks the engine to carry the plan out. */
  continueInAuto: boolean;
}

export const respondToPlan = (
  planId: string,
  revision: number,
  decision: PlanDecision,
  feedback?: string,
) => invoke<PlanDecided>("engine_plan_respond", { planId, revision, decision, feedback });
