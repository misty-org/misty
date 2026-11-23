import { invoke } from "@/native/invoke";
import type { EnginePlanReview } from "../../../runs/invocations/invocation_types";

export type EngineAnswers = Record<string, string | string[]>;

export const answerEngineQuestion = (
  runId: string,
  requestId: string,
  answers: EngineAnswers | null,
) => invoke<void>("engine_answer_question", { runId, requestId, answers });

export type PlanDecision = "approve" | "request_changes" | "defer";

interface PlanDecided {
  review: EnginePlanReview;
  native: boolean;
  continueInAuto: boolean;
}

export const respondToPlan = (
  planId: string,
  revision: number,
  decision: PlanDecision,
  feedback?: string,
) => invoke<PlanDecided>("engine_plan_respond", { planId, revision, decision, feedback });
