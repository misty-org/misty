import type { SpacesStore } from "./spacesStoreTypes";
import { SpaceRequestError } from "@/api/spaces/api";
import { setSpaceReferenceOnly, subscribeSpaceReferenceOnly } from "@/api/spaces/connectivity";
import type { SpacesSnapshot } from "@/api/spaces/dto/entities";

export function liveSpaceSnapshotState(snapshot: SpacesSnapshot): Partial<SpacesStore> {
  setSpaceReferenceOnly(false);
  return {
    spaces: snapshot.spaces,
    invitations: snapshot.invitations,
    snapshotReady: true,
    referenceOnly: false,
    loading: false,
  };
}

export async function referenceSpaceSnapshotState(
  error: unknown,
): Promise<Partial<SpacesStore> | null> {
  if (!canUseSpaceReferenceFallback(error)) return null;
  setSpaceReferenceOnly(true);
  return {
    spaces: [],
    invitations: [],
    membersBySpace: {},
    messagesBySpace: {},
    nodesBySpace: {},
    snapshotReady: false,
    referenceOnly: true,
    loading: false,
    error: null,
  };
}

function canUseSpaceReferenceFallback(error: unknown): boolean {
  if (!(error instanceof SpaceRequestError)) return true;
  return error.status === 429 || error.status >= 500;
}

export function resetSpaceReferenceMode(): void {
  setSpaceReferenceOnly(false);
}

export function bindSpaceReferenceMode(
  update: (state: Pick<SpacesStore, "referenceOnly">) => void,
): void {
  subscribeSpaceReferenceOnly((referenceOnly) => update({ referenceOnly }));
}
