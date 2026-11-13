import { useSpacesStore } from "../../list/useSpacesStore";
import { spacesApi } from "../../api/api";
import type { SpaceInvitation } from "../../api/dto/entities";
import { useCallback, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { canManageSpaceLifecycle } from "../../routes/defaultSpace";

const emptyMembers: never[] = [];

/** The Space's members and its pending invitations, with owner-only gating. */
export function useSpaceMembers(spaceId: string) {
  const [pendingInvitations, setPendingInvitations] = useState<SpaceInvitation[]>([]);
  const space = useSpacesStore((state) => state.spaces.find((item) => item.id === spaceId));
  const store = useSpacesStore(
    useShallow((state) => ({
      membersBySpace: state.membersBySpace,
      loading: state.loading,
      error: state.error,
      invite: state.invite,
      removeMember: state.removeMember,
      transferOwner: state.transferOwner,
      load: state.load,
      clearError: state.clearError,
    })),
  );
  const members = store.membersBySpace[spaceId] ?? emptyMembers;
  // Only a first load with no copy draws the skeleton; a saved list paints at once.
  const membersLoading = store.loading && !store.membersBySpace[spaceId];
  const owner = space?.role === "owner";
  const canManageMembers = owner;

  const loadPendingInvitations = useCallback(async () => {
    if (!canManageMembers) {
      setPendingInvitations([]);
      return;
    }
    try {
      setPendingInvitations((await spacesApi.pendingInvitations(spaceId)).invitations);
    } catch {
      setPendingInvitations([]);
    }
  }, [canManageMembers, spaceId]);

  useEffect(() => {
    void loadPendingInvitations();
  }, [loadPendingInvitations]);

  return {
    ...store,
    space,
    members,
    membersLoading,
    owner,
    canManageMembers,
    canTransferOwnership: owner && canManageSpaceLifecycle(space, "transfer"),
    canInvite: canManageMembers,
    pendingInvitations,
    loadPendingInvitations,
  };
}

export type SpaceMembersState = ReturnType<typeof useSpaceMembers>;
