import type { ComponentType } from "react";
import { createPort } from "@/shared/lib/seams";

export type SetupStep = "tabs" | "projects";

/** The first-run steps shown inside the sign-in sheet; onboarding fills them in. */
export const setupFlow = createPort<{
  stepCopy: Record<SetupStep, string>;
  useSteps: () => SetupStep[];
  StepBody: ComponentType<{ step: SetupStep; onNext(): void }>;
  /** Whether a step has what it needs to go on; one that asks for a choice waits for it. */
  useStepDone: (step: SetupStep | null) => boolean;
}>("the first-run setup steps");
