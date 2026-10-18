import { Check, Circle, CircleAlert, CircleMinus, CirclePause } from "lucide-react";
import { Spinner } from "@/shared/ui";
import type { PlanStepStatus } from "./types";

export const statusText: Record<PlanStepStatus, string> = {
  pending: "Not started",
  in_progress: "In progress",
  done: "Done",
  skipped: "Skipped",
  blocked: "Blocked",
};

/**
 * A monochrome step icon. A step in progress spins while its run works; once the
 * run stopped, or waits on the person or a device, it pauses instead.
 */
export function StepIcon({ status, paused }: { status: PlanStepStatus; paused?: boolean }) {
  if (status === "in_progress" && paused) return <CirclePause size={14} aria-hidden="true" />;
  if (status === "in_progress") return <Spinner size="sm" label={false} />;
  const Icon = { pending: Circle, done: Check, skipped: CircleMinus, blocked: CircleAlert }[status];
  return <Icon size={14} aria-hidden="true" />;
}
