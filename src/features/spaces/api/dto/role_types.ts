export interface SpaceRoleDef {
  id: string;
  space_id: string;
  name: string;
  color: string;
  position: number;
  hoist: boolean;
  mentionable: boolean;
  permissions: SpacePermission[];
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface ChannelOverwrite {
  role_id: string;
  allow: SpacePermission[];
  deny: SpacePermission[];
}

export type SpacePermission =
  | "administrator"
  | "roles.manage"
  | "channels.manage"
  | "messages.manage"
  | "members.remove"
  | "space.invite"
  | "space.rename"
  | "messages.read"
  | "messages.write"
  | "attachments.upload"
  | "storage.view_own_usage"
  | "ask.run"
  | "space.leave"
  | "space.transfer"
  | "space.delete";

export const channelPermissions = [
  "messages.read",
  "messages.write",
  "attachments.upload",
  "messages.manage",
] as const satisfies readonly SpacePermission[];

export type RoleInput = Partial<
  Pick<SpaceRoleDef, "name" | "color" | "hoist" | "mentionable" | "permissions">
>;
