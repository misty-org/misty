import type { AvatarDecoration } from "@/shared/lib/avatar_decoration";
import { spaceRequest, spacesApi } from "../api/api";
import type { SpaceInvitation } from "../api/dto/entities";
import { refreshSpaceResource, useSpaceResource } from "../api/space_resource";

export interface FriendPerson {
  user_id: string;
  username: string;
  avatar_version: number;
  avatar_decoration?: AvatarDecoration;
}

const invitationsPath = (spaceId: string) => `/spaces/${encodeURIComponent(spaceId)}/invitations`;

const loadInvitations = (spaceId: string) => () =>
  spacesApi.pendingInvitations(spaceId).then((result) => result.invitations);

export function useSpaceInvitations(spaceId: string, enabled: boolean) {
  return useSpaceResource<SpaceInvitation[]>(
    enabled ? invitationsPath(spaceId) : null,
    loadInvitations(spaceId),
  );
}

export function reloadSpaceInvitations(spaceId: string) {
  return refreshSpaceResource(invitationsPath(spaceId), loadInvitations(spaceId));
}

export function useFriendPeople() {
  return useSpaceResource<{ friends: FriendPerson[] }>("/friends", () =>
    spaceRequest<{ friends: FriendPerson[] }>("/friends"),
  );
}

export function invitationName(invitation: SpaceInvitation): string {
  return invitation.invited_user_name || invitation.invited_email;
}

export function expiresLine(expiresAt: string, now: number): string {
  const days = Math.ceil((Date.parse(expiresAt) - now) / 86_400_000);
  if (days <= 1) return "Expires today";
  if (days === 2) return "Expires tomorrow";
  return `Expires in ${days} days`;
}
