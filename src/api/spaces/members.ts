import type { SpaceInvitation, SpaceMember } from "@/api/spaces/dto/entities";
import type { SpaceRequest } from "./types";

type ProtectedBlobRequest = (path: string, init?: RequestInit) => Promise<Blob>;

export function createSpaceMembersApi(
  request: SpaceRequest,
  fetchProtectedBlob: ProtectedBlobRequest,
) {
  const memberPath = (spaceId: string, userId: string) =>
    `/spaces/${encodeURIComponent(spaceId)}/members/${encodeURIComponent(userId)}`;

  return {
    members: (spaceId: string, onCached?: (value: { members: SpaceMember[] }) => void) =>
      request<{ members: SpaceMember[] }>(`/spaces/${encodeURIComponent(spaceId)}/members`, {
        onCached,
      }),
    memberAvatar: (spaceId: string, userId: string) =>
      fetchProtectedBlob(`${memberPath(spaceId, userId)}/avatar`),
    invite: (spaceId: string, email: string) =>
      request<SpaceInvitation>(`/spaces/${encodeURIComponent(spaceId)}/invitations`, {
        method: "POST",
        body: JSON.stringify({ email }),
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
