import type { PlanStepStatus } from "./planTypes";

export const statusText: Record<PlanStepStatus, string> = {
  pending: "Not started",
  in_progress: "In progress",
  done: "Done",
  skipped: "Skipped",
  blocked: "Blocked",
};
