import type { Space } from "@/api/spaces/dto/interfaces/types";

export type OnboardingStarterApp = "chat" | "journal" | "planner";

const ACCOUNT_CREATING_STORAGE_KEY = "misty:account-creating";

export function markAccountCreating(accountId: string): void {
  try {
    sessionStorage.setItem(`${ACCOUNT_CREATING_STORAGE_KEY}:${accountId}`, "true");
  } catch {}
}

export function clearAccountCreating(accountId: string): void {
  try {
    sessionStorage.removeItem(`${ACCOUNT_CREATING_STORAGE_KEY}:${accountId}`);
  } catch {}
}

export function isAccountCreating(accountId: string | undefined): boolean {
  if (!accountId) return false;
  try {
    return sessionStorage.getItem(`${ACCOUNT_CREATING_STORAGE_KEY}:${accountId}`) === "true";
  } catch {
    return false;
  }
}

/**
 * Onboarding screen is only shown IFF users are actively creating an account
 * and have not yet created their own default Space.
 */
export function accountNeedsOnboarding(
  accountId: string | undefined,
  snapshotReady: boolean,
  spaces: Space[],
  isCreating: boolean = isAccountCreating(accountId),
): boolean {
  return Boolean(
    accountId &&
    isCreating &&
    snapshotReady &&
    !spaces.some((space) => space.is_default && space.owner_user_id === accountId),
  );
}

export function onboardingSpaceRoute(spaceId: string): string {
  return `/spaces/${encodeURIComponent(spaceId)}`;
}
