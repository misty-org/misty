import type { SpacesStore } from "@/models/interfaces/stores/spaces/useSpacesStore";
import type { SpacesSnapshot } from "@/models/interfaces/features/spaces/types";
import { SpaceRequestError } from "./useSpacesBackendStore";
import { removeSpaceReferenceCache, setSpaceReferenceAccount } from "./spaceReferenceCache";
import { setSpaceReferenceOnly, subscribeSpaceReferenceOnly } from "./spaceConnectivity";

let clearedReferenceCacheAccount = "";

export function setSpaceReferenceModeAccount(accountId: string): void {
  const normalizedAccountId = accountId.trim();
  setSpaceReferenceAccount(normalizedAccountId);
  // Saved-copy mode has been retired. Remove any encrypted reference cache
  // left by an earlier build so it cannot become a fallback again.
  if (normalizedAccountId && normalizedAccountId !== clearedReferenceCacheAccount) {
    clearedReferenceCacheAccount = normalizedAccountId;
    void removeSpaceReferenceCache(normalizedAccountId);
  }
}

export function liveSpaceSnapshotState(snapshot: SpacesSnapshot): Partial<SpacesStore> {
  const lastSyncedAt = new Date().toISOString();
  setSpaceReferenceOnly(false);
  return {
    spaces: snapshot.spaces,
    invitations: snapshot.invitations,
    limits: snapshot.entitlements,
    ownerStorage: snapshot.owner_storage,
    snapshotReady: true,
    referenceOnly: false,
    lastSyncedAt,
    loading: false,
  };
}

export async function referenceSpaceSnapshotState(
  error: unknown,
  _current: SpacesStore,
): Promise<Partial<SpacesStore> | null> {
  if (!canUseSpaceReferenceFallback(error)) return null;
  setSpaceReferenceOnly(true);
  return {
    spaces: [],
    invitations: [],
    limits: null,
    ownerStorage: null,
    membersBySpace: {},
    agentMembershipsBySpace: {},
    messagesBySpace: {},
    nodesBySpace: {},
    agentsBySpace: {},
    workflowsBySpace: {},
    snapshotReady: false,
    referenceOnly: true,
    lastSyncedAt: null,
    loading: false,
    error: null,
  };
}

export function canUseSpaceReferenceFallback(error: unknown): boolean {
  if (!(error instanceof SpaceRequestError)) return true;
  return error.status === 429 || error.status >= 500;
}

export function resetSpaceReferenceMode(): void {
  setSpaceReferenceOnly(false);
  setSpaceReferenceAccount("");
  clearedReferenceCacheAccount = "";
}

export function bindSpaceReferenceMode(
  update: (state: Pick<SpacesStore, "referenceOnly">) => void,
): void {
  subscribeSpaceReferenceOnly((referenceOnly) => update({ referenceOnly }));
}
