import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { spacesApi } from "../api/api";
import type { Space, SpaceMember, SpacePermission, SpaceRoleDef } from "../api/dto/entities";
import { useSpacesStore } from "../list/use_spaces_store";

interface SpaceRolesState {
  bySpace: Record<string, SpaceRoleDef[]>;
  load(spaceId: string): Promise<void>;
  set(spaceId: string, roles: SpaceRoleDef[]): void;
}

const byPosition = (roles: SpaceRoleDef[]) =>
  [...roles].sort((left, right) => right.position - left.position);

const reads = new Map<string, Promise<void>>();

export const useSpaceRolesStore = create<SpaceRolesState>((set, get) => ({
  bySpace: {},
  load(spaceId) {
    const running = reads.get(spaceId);
    if (running) return running;
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

const memberDefaults: SpacePermission[] = [
  "messages.read",
  "messages.write",
  "attachments.upload",
  "storage.view_own_usage",
  "ask.run",
  "space.leave",
];

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

export function memberCan(spaceId: string, userId: string, permission: SpacePermission): boolean {
  const spaces = useSpacesStore.getState();
  if (spaces.spaces.find((item) => item.id === spaceId)?.owner_user_id === userId) return true;
  const member = spaces.membersBySpace[spaceId]?.find((item) => item.user_id === userId);
  if (!member) return false;
  if (member.role === "owner") return true;
  const roles = useSpaceRolesStore.getState().bySpace[spaceId] ?? [];
  return roles.some(
    (role) =>
      (role.is_default || Boolean(member.role_ids?.includes(role.id))) &&
      (role.permissions.includes("administrator") || role.permissions.includes(permission)),
  );
}

export function prepareMemberCan(spaceId: string): Promise<void> {
  const spaces = useSpacesStore.getState();
  return Promise.all([
    spaces.membersBySpace[spaceId] ? undefined : spaces.loadMembers(spaceId),
    useSpaceRolesStore.getState().bySpace[spaceId]
      ? undefined
      : useSpaceRolesStore.getState().load(spaceId),
  ]).then(() => undefined);
}

export function memberRoles(member: SpaceMember | undefined, roles: SpaceRoleDef[] | undefined) {
  if (!member?.role_ids?.length || !roles) return [];
  return roles.filter((role) => !role.is_default && member.role_ids!.includes(role.id));
}

export function memberColor(member: SpaceMember | undefined, roles: SpaceRoleDef[] | undefined) {
  return memberRoles(member, roles).find((role) => role.color)?.color ?? "";
}

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
