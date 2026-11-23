import type { SpaceConversation, SpaceMember } from "./dto/entities";
import type { ChannelOverwrite, RoleInput, SpaceRoleDef } from "./dto/role_types";
import type { SpaceRequest } from "./space_request_types";

const listOf = <T>(value: T[] | { roles?: T[] } | null | undefined): T[] =>
  Array.isArray(value) ? value : (value?.roles ?? []);

export function createSpaceRolesApi(request: SpaceRequest) {
  const base = (spaceId: string) => `/spaces/${encodeURIComponent(spaceId)}`;
  const rolePath = (spaceId: string, roleId: string) =>
    `${base(spaceId)}/roles/${encodeURIComponent(roleId)}`;
  return {
    roles: async (spaceId: string) =>
      listOf(await request<SpaceRoleDef[] | { roles: SpaceRoleDef[] }>(`${base(spaceId)}/roles`)),
    createRole: (spaceId: string, input: RoleInput) =>
      request<SpaceRoleDef>(`${base(spaceId)}/roles`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    updateRole: (spaceId: string, roleId: string, input: RoleInput) =>
      request<SpaceRoleDef>(rolePath(spaceId, roleId), {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    deleteRole: (spaceId: string, roleId: string) =>
      request(rolePath(spaceId, roleId), { method: "DELETE" }),
    reorderRoles: async (spaceId: string, roleIds: string[]) =>
      listOf(
        await request<SpaceRoleDef[] | { roles: SpaceRoleDef[] }>(`${base(spaceId)}/roles/order`, {
          method: "PUT",
          body: JSON.stringify({ role_ids: roleIds }),
        }),
      ),
    setMemberRoles: (spaceId: string, userId: string, roleIds: string[]) =>
      request<SpaceMember>(`${base(spaceId)}/members/${encodeURIComponent(userId)}/roles`, {
        method: "PUT",
        body: JSON.stringify({ role_ids: roleIds }),
      }),
    setChannelOverwrites: (
      spaceId: string,
      conversationId: string,
      overwrites: ChannelOverwrite[],
    ) =>
      request<SpaceConversation>(
        `${base(spaceId)}/conversations/${encodeURIComponent(conversationId)}/overwrites`,
        { method: "PUT", body: JSON.stringify({ overwrites }) },
      ),
  };
}
