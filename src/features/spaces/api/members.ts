import type { SpaceInvitation, SpaceMember } from "./dto/entities";
import type { SpaceRequest } from "./space_request_types";

export interface SpaceMembersList {
  members: SpaceMember[];
}

type ProtectedBlobRequest = (path: string, init?: RequestInit) => Promise<Blob>;

export function createSpaceMembersApi(
  request: SpaceRequest,
  fetchProtectedBlob: ProtectedBlobRequest,
) {
  const memberPath = (spaceId: string, userId: string) =>
    `/spaces/${encodeURIComponent(spaceId)}/members/${encodeURIComponent(userId)}`;

  return {
    members: (spaceId: string, onCached?: (value: SpaceMembersList) => void) =>
      request<SpaceMembersList>(`/spaces/${encodeURIComponent(spaceId)}/members`, {
        onCached,
      }),
    personAvatar: (userId: string) =>
      fetchProtectedBlob(`/people/${encodeURIComponent(userId)}/avatar`),
    invite: (spaceId: string, email: string) =>
      request<SpaceInvitation>(`/spaces/${encodeURIComponent(spaceId)}/invitations`, {
        method: "POST",
        body: JSON.stringify({ email }),
      }),
    inviteFriend: (spaceId: string, userId: string) =>
      request<SpaceInvitation>(`/spaces/${encodeURIComponent(spaceId)}/invitations`, {
        method: "POST",
        body: JSON.stringify({ user_id: userId }),
      }),
    pendingInvitations: (spaceId: string) =>
      request<{ invitations: SpaceInvitation[] }>(
        `/spaces/${encodeURIComponent(spaceId)}/invitations`,
      ),
    resendInvitation: (spaceId: string, inviteId: string) =>
      request<SpaceInvitation>(
        `/spaces/${encodeURIComponent(spaceId)}/invitations/${encodeURIComponent(inviteId)}/resend`,
        { method: "POST" },
      ),
    revokeInvitation: (spaceId: string, inviteId: string) =>
      request(
        `/spaces/${encodeURIComponent(spaceId)}/invitations/${encodeURIComponent(inviteId)}`,
        {
          method: "DELETE",
        },
      ),
    respondInvite: (inviteId: string, accept: boolean) =>
      request(
        `/spaces/invitations/${encodeURIComponent(inviteId)}/${accept ? "accept" : "decline"}`,
        {
          method: "POST",
        },
      ),
    removeMember: (spaceId: string, userId: string) =>
      request(memberPath(spaceId, userId), { method: "DELETE" }),
    leave: (spaceId: string) =>
      request(`/spaces/${encodeURIComponent(spaceId)}/leave`, { method: "POST" }),
    transfer: (spaceId: string, userId: string) =>
      request(`/spaces/${encodeURIComponent(spaceId)}/transfer`, {
        method: "POST",
        body: JSON.stringify({ user_id: userId }),
      }),
  };
}
