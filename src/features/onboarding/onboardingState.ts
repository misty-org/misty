import { deploymentStorageKey } from "@/api/deployment/api";

export const onboardingVersion = 1;

export type OnboardingPurpose = "plan" | "organize" | "collaborate" | "explore";
export type OnboardingStart = "note" | "task" | "social" | "library";

export interface OnboardingCompletion {
  version: number;
  completedAt: string;
  outcome: "completed" | "skipped";
  purpose?: OnboardingPurpose;
  start?: OnboardingStart;
  hostedAiEnabled?: boolean;
}

const storageKey = (accountId: string) =>
  deploymentStorageKey(`misty:onboarding:v${onboardingVersion}:${accountId}`);

export function readOnboardingCompletion(accountId: string): OnboardingCompletion | null {
  if (!accountId) return null;
  try {
    const raw = window.localStorage.getItem(storageKey(accountId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OnboardingCompletion>;
    if (parsed.version !== onboardingVersion || !parsed.completedAt) return null;
    return parsed as OnboardingCompletion;
  } catch {
    return null;
  }
}

export function writeOnboardingCompletion(
  accountId: string,
  completion: Omit<OnboardingCompletion, "version" | "completedAt">,
): void {
  if (!accountId) return;
  try {
    window.localStorage.setItem(
      storageKey(accountId),
      JSON.stringify({
        ...completion,
        version: onboardingVersion,
        completedAt: new Date().toISOString(),
      } satisfies OnboardingCompletion),
    );
  } catch {
    // A private context may not allow local storage. The flow still completes
    // for this session and can be skipped again on the next launch.
  }
}

export function onboardingStartRoute(spaceId: string, start: OnboardingStart): string {
  const base = `/spaces/${encodeURIComponent(spaceId)}`;
  if (start === "note") return `${base}/notes?create=note`;
  if (start === "task") return `${base}/planner/tasks/board?create=task`;
  if (start === "social") return `${base}/social/misty`;
  return `${base}/library?upload=1`;
}

export function suggestedSpaceName(purpose: OnboardingPurpose): string {
  if (purpose === "plan") return "My projects";
  if (purpose === "organize") return "My knowledge";
  if (purpose === "collaborate") return "My team";
  return "My Space";
}
