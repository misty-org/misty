/**
 * A Space's roles, after Discord: each carries a name, a color, its place in the order and the
 * permissions it grants. Every Space has one default role, `everyone`, which every member has
 * without it being listed on them; only its permissions change.
 */
export interface SpaceRoleDef {
  id: string;
  space_id: string;
  name: string;
  /** "#rrggbb", or empty for none. */
  color: string;
  /** Higher is above; the default role is 0. */
  position: number;
  /** Its members are listed in a group of its own in the member list. */
  hoist: boolean;
  mentionable: boolean;
  permissions: SpacePermission[];
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

/** What a channel's overwrite changes for one role there: added, then taken away. */
export interface ChannelOverwrite {
  role_id: string;
  allow: SpacePermission[];
  deny: SpacePermission[];
}

/** The server's permission names (`internal/spaces/permissions.go`). */
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
  | "library.view"
  | "library.upload"
  | "library.add"
  | "library.edit"
  | "library.download"
  | "library.import"
  | "storage.view_own_usage"
  | "studio.view"
  | "ask.run"
  | "integrations.manage"
  | "apps.manage"
  | "space.leave"
  | "space.transfer"
  | "space.delete";

/** The permissions an overwrite may name: the ones that differ between channels. */
export const channelPermissions = [
  "messages.read",
  "messages.write",
  "attachments.upload",
  "messages.manage",
] as const satisfies readonly SpacePermission[];

export type RoleInput = Partial<
  Pick<SpaceRoleDef, "name" | "color" | "hoist" | "mentionable" | "permissions">
>;
