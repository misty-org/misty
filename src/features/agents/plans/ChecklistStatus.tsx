import type { PlanStepStatus } from "./plan_types";

export const statusText: Record<PlanStepStatus, string> = {
  pending: "Not started",
  in_progress: "In progress",
  done: "Done",
  skipped: "Skipped",
  blocked: "Blocked",
};
