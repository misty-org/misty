import type { ComponentType } from "react";
import { createPort } from "@/shared/lib/seams";

export type SetupStep = "import" | "extensions" | "tabs";

/** The first-run steps shown inside the sign-in sheet; onboarding fills them in. */
export const setupFlow = createPort<{
  stepCopy: Record<SetupStep, string>;
  useSteps: () => SetupStep[];
  StepBody: ComponentType<{ step: SetupStep; onNext(): void }>;
  /** The model step belongs to agents (Settings › Models); it loads when the wizard reaches it. */
  ModelSetupPanel: ComponentType;
}>("the first-run setup steps");
