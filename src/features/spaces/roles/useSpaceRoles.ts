import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { spacesApi } from "../api/api";
import type { Space, SpaceMember, SpacePermission, SpaceRoleDef } from "../api/dto/entities";
import { useSpacesStore } from "../list/useSpacesStore";

interface SpaceRolesState {
  /** Each Space's roles, top first; missing until read. */
  bySpace: Record<string, SpaceRoleDef[]>;
  load(spaceId: string): Promise<void>;
  set(spaceId: string, roles: SpaceRoleDef[]): void;
}

const byPosition = (roles: SpaceRoleDef[]) =>
  [...roles].sort((left, right) => right.position - left.position);

const reads = new Map<string, Promise<void>>();

/** A Space's roles as the server has them, read once and again on every role event. */
export const useSpaceRolesStore = create<SpaceRolesState>((set, get) => ({
  bySpace: {},
  load(spaceId) {
    const running = reads.get(spaceId);
    if (running) return running;
    // Started on the next tick, so a failure of any kind ends up in the promise, never the caller.
    const read = Promise.resolve()
      .then(() => spacesApi.roles(spaceId))
      .then((roles) => get().set(spaceId, roles))
      .finally(() => reads.delete(spaceId));
    reads.set(spaceId, read);
    return read;
  },
  set(spaceId, roles) {
    set((state) => ({ bySpace: { ...state.bySpace, [spaceId]: byPosition(roles) } }));
  },
}));

/** The Space's roles, top first, with the default `everyone` role last. */
export function useSpaceRoles(spaceId: string): SpaceRoleDef[] | undefined {
  const roles = useSpaceRolesStore((state) => state.bySpace[spaceId]);
  useEffect(() => {
    if (spaceId && !roles)
      void useSpaceRolesStore
        .getState()
        .load(spaceId)
        .catch(() => undefined);
  }, [roles, spaceId]);
  return roles;
}

/** What every member may do before roles: what a server without roles still allows. */
const memberDefaults: SpacePermission[] = [
  "messages.read",
  "messages.write",
  "attachments.upload",
  "storage.view_own_usage",
  "studio.view",
  "ask.run",
  "space.leave",
];

/**
 * Whether the person may do something in a Space: the server's word (`Space.permissions`), or,
 * from a server before roles, what an owner and a member could always do.
 */
export function spaceCan(space: Space | undefined, permission: SpacePermission): boolean {
  if (!space) return false;
  if (space.role === "owner") return true;
  const granted = space.permissions ?? memberDefaults;
  return granted.includes("administrator") || granted.includes(permission);
}

export function useSpaceCan(spaceId: string, permission: SpacePermission): boolean {
  const space = useSpacesStore((state) => state.spaces.find((item) => item.id === spaceId));
  return spaceCan(space, permission);
}

/** A member's roles, top first, without the default one. */
export function memberRoles(member: SpaceMember | undefined, roles: SpaceRoleDef[] | undefined) {
  if (!member?.role_ids?.length || !roles) return [];
  return roles.filter((role) => !role.is_default && member.role_ids!.includes(role.id));
}

/** The color a member's name wears: their highest role that has one. */
export function memberColor(member: SpaceMember | undefined, roles: SpaceRoleDef[] | undefined) {
  return memberRoles(member, roles).find((role) => role.color)?.color ?? "";
}

/** Each member's name color by user id, for a list of messages. */
export function useMemberColors(spaceId: string): Map<string, string> {
  const roles = useSpaceRoles(spaceId);
  const members = useSpacesStore((state) => state.membersBySpace[spaceId]);
  return useMemo(() => {
    const colors = new Map<string, string>();
    for (const member of members ?? []) {
      const color = memberColor(member, roles);
      if (color) colors.set(member.user_id, color);
    }
    return colors;
  }, [members, roles]);
}
