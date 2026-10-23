import { cachedRequest } from "@/api/cache/cached-request";

/** Get started steps only the server sees the account do. */
export type OnboardingStep = "page_ask" | "workflow_run";

export const onboardingApi = {
  steps: () => cachedRequest<{ steps: OnboardingStep[] }>("/misty/onboarding"),
};
