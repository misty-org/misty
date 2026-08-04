import type { SpacesStore } from "@/models/interfaces/stores/spaces/useSpacesStore";
import type { SpacesSnapshot } from "@/models/interfaces/features/spaces/types";
import { SpaceRequestError } from "./useSpacesBackendStore";
import {
  cacheSpaceSnapshot,
  readSpaceReferenceCache,
  setSpaceReferenceAccount,
} from "./spaceReferenceCache";
import { setSpaceReferenceOnly, subscribeSpaceReferenceOnly } from "./spaceConnectivity";

export function setSpaceReferenceModeAccount(accountId: string): void {
  setSpaceReferenceAccount(accountId);
}

export function liveSpaceSnapshotState(snapshot: SpacesSnapshot): Partial<SpacesStore> {
  const lastSyncedAt = new Date().toISOString();
  setSpaceReferenceOnly(false);
  cacheSpaceSnapshot(snapshot);
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
  current: SpacesStore,
): Promise<Partial<SpacesStore> | null> {
  if (!canUseSpaceReferenceFallback(error)) return null;
  const cached = await readSpaceReferenceCache();
  if (!cached && current.spaces.length === 0) return null;
  setSpaceReferenceOnly(true);
  return {
    spaces: cached?.snapshot.spaces ?? current.spaces,
    invitations: [],
    limits: cached?.snapshot.entitlements ?? current.limits,
    ownerStorage: cached?.snapshot.owner_storage ?? current.ownerStorage,
    membersBySpace: cached?.membersBySpace ?? current.membersBySpace,
    messagesBySpace: cached?.messagesBySpace ?? current.messagesBySpace,
    nodesBySpace: cached?.nodesBySpace ?? current.nodesBySpace,
    snapshotReady: true,
    referenceOnly: true,
    lastSyncedAt: cached?.savedAt ?? current.lastSyncedAt,
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
}

export function bindSpaceReferenceMode(
  update: (state: Pick<SpacesStore, "referenceOnly">) => void,
): void {
  subscribeSpaceReferenceOnly((referenceOnly) => update({ referenceOnly }));
}
