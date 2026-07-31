import type { SpaceInvitation, SpaceMember } from "@/models/interfaces/features/spaces/types";

type SpaceRequest = <T = void>(path: string, init?: RequestInit) => Promise<T>;
type ProtectedBlobRequest = (path: string, init?: RequestInit) => Promise<Blob>;

export function createSpaceMembersApi(
  request: SpaceRequest,
  fetchProtectedBlob: ProtectedBlobRequest,
) {
  const memberPath = (spaceId: string, userId: string) =>
    `/spaces/${encodeURIComponent(spaceId)}/members/${encodeURIComponent(userId)}`;

  return {
    members: (spaceId: string) =>
      request<{ members: SpaceMember[] }>(`/spaces/${encodeURIComponent(spaceId)}/members`),
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
    memberPermissions: (spaceId: string, userId: string) =>
      request<{ permissions: Record<string, boolean> }>(
        `${memberPath(spaceId, userId)}/permissions`,
      ),
    setMemberPermission: (
      spaceId: string,
      userId: string,
      permission: string,
      effect: "allow" | "deny" | "inherit",
    ) =>
      request<{ permissions: Record<string, boolean> }>(
        `${memberPath(spaceId, userId)}/permissions`,
        {
          method: "PUT",
          body: JSON.stringify({ permission, effect }),
        },
      ),
  };
}
