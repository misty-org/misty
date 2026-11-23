import type { ComponentType } from "react";
import { createPort } from "@/shared/lib/seams";

export type SetupStep = "tabs" | "projects";

export const setupFlow = createPort<{
  stepCopy: Record<SetupStep, string>;
  useSteps: () => SetupStep[];
  StepBody: ComponentType<{ step: SetupStep; onNext(): void }>;
  useStepDone: (step: SetupStep | null) => boolean;
}>("the first-run setup steps");
