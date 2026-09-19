import { useWorkspaceStore } from "@/features/workspace/useWorkspaceStore";
import { preferredDefaultSpace, useSpacesStore } from "@/features/spaces/core";
import { apiRequest } from "@/api/client";
import { useAppsStore } from "@/features/apps/useAppsStore";
export function currentMistySpace(): string {
  const scope = useWorkspaceStore.getState().activeScopeKey;
  return scope.startsWith("space:")
    ? scope.slice(6)
    : (preferredDefaultSpace(useSpacesStore.getState().spaces)?.id ?? "");
}

export async function assertMistyAvailable(accountId: string, spaceId: string): Promise<void> {
  if (!accountId) throw new Error("Sign in to use Misty.");
  const state = useAppsStore.getState();
  if (state.accountId !== accountId)
    throw new Error("The Misty account changed. Open Misty again.");
  await apiRequest(spaceId ? `/spaces/${encodeURIComponent(spaceId)}` : "/me");
  if (useAppsStore.getState().accountId !== accountId)
    throw new Error("The Misty account changed.");
}
