import { apiRequest } from "@/api/client";

/** Get started steps only the server sees the account do. */
export type OnboardingStep = "page_ask" | "workflow_run";

export const onboardingApi = {
  steps: () => apiRequest<{ steps: OnboardingStep[] }>("/misty/onboarding", { cache: "no-store" }),
};
