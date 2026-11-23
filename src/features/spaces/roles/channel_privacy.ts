import type { ChannelOverwrite, SpaceConversation, SpacePermission } from "../api/dto/entities";

const read: SpacePermission = "messages.read";

export function allowedRoleIds(conversation: SpaceConversation | null | undefined): string[] {
  return (conversation?.overwrites ?? [])
    .filter((overwrite) => overwrite.allow.includes(read))
    .map((overwrite) => overwrite.role_id);
}

export function withPrivacy(
  current: ChannelOverwrite[],
  defaultRoleId: string,
  isPrivate: boolean,
  allowed: string[],
): ChannelOverwrite[] {
  const byRole = new Map(
    current.map((overwrite) => [
      overwrite.role_id,
      {
        role_id: overwrite.role_id,
        allow: overwrite.allow.filter((permission) => permission !== read),
        deny: overwrite.deny.filter((permission) => permission !== read),
      },
    ]),
  );
  const of = (roleId: string) =>
    byRole.get(roleId) ?? byRole.set(roleId, { role_id: roleId, allow: [], deny: [] }).get(roleId)!;
  if (isPrivate) {
    of(defaultRoleId).deny.push(read);
    for (const roleId of allowed) if (roleId !== defaultRoleId) of(roleId).allow.push(read);
  }
  return [...byRole.values()].filter(
    (overwrite) => overwrite.allow.length || overwrite.deny.length,
  );
}
