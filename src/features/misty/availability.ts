import { apiRequest } from "@/api/client";
import { isApiSessionTransitioning, readApiSessionGeneration } from "@/api/client/session";
import { useUserStore } from "@/features/auth/core";

/** Agent admission follows the verified account, independently of website groups. */
export async function assertMistyAvailable(
  accountId: string,
  _legacySpaceId?: string,
): Promise<void> {
  if (!accountId) throw new Error("Sign in to use Misty.");
  const generation = readApiSessionGeneration();
  const sameAccount = () =>
    !isApiSessionTransitioning() &&
    readApiSessionGeneration() === generation &&
    useUserStore.getState().me?.id === accountId;
  if (!sameAccount()) throw new Error("The Misty account changed. Open Misty again.");
  const me = await apiRequest<{ id: string }>("/me");
  if (!sameAccount() || me.id !== accountId) throw new Error("The Misty account changed.");
}
