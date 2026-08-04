import { useCallback, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useMinimumSpin } from "@/hooks/useMinimumSpin";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import type { SpaceInvitation } from "@/models/interfaces/features/spaces/types";

const emptyMembers: never[] = [];

/** The Space's members and its pending invitations, with owner-only gating. */
export function useSpaceMembers(spaceId: string) {
  const [pendingInvitations, setPendingInvitations] = useState<SpaceInvitation[]>([]);
  const space = useSpacesStore((state) => state.spaces.find((item) => item.id === spaceId));
  const store = useSpacesStore(
    useShallow((state) => ({
      membersBySpace: state.membersBySpace,
      agentMembershipsBySpace: state.agentMembershipsBySpace,
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
  const agents = store.agentMembershipsBySpace[spaceId] ?? emptyMembers;
  const [membersLoading] = useMinimumSpin(store.loading && members.length === 0);
  const owner = space?.role === "owner";

  const loadPendingInvitations = useCallback(async () => {
    if (!owner) {
      setPendingInvitations([]);
      return;
    }
    try {
      setPendingInvitations((await spacesApi.pendingInvitations(spaceId)).invitations);
    } catch {
      setPendingInvitations([]);
    }
  }, [owner, spaceId]);

  useEffect(() => {
    void loadPendingInvitations();
  }, [loadPendingInvitations]);

  return {
    ...store,
    space,
    members,
    agents,
    membersLoading,
    owner,
    canInvite: owner,
    canManageAgents: owner || space?.permissions?.["agents.manage"] === true,
    pendingInvitations,
    loadPendingInvitations,
  };
}

export type SpaceMembersState = ReturnType<typeof useSpaceMembers>;
