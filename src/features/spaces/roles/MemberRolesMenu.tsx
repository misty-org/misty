import { useState, type ReactElement } from "react";
import { useAuth } from "@/features/account";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  MenuCheckItem,
  RoleDot,
  useNotice,
} from "@/shared/ui";
import { spacesApi } from "../api/api";
import type { Space, SpaceMember } from "../api/dto/entities";
import { useSpacesStore } from "../list/useSpacesStore";
import { spaceCan, useSpaceRoles } from "./useSpaceRoles";

/**
 * A member's roles to give or take, opened from their row in the member list, as Discord's
 * profile does. Only for those who manage roles, and only roles below their own highest one;
 * for anyone else the row opens nothing.
 */
export function MemberRolesMenu(props: {
  space: Space;
  member: SpaceMember;
  children: ReactElement;
}) {
  const { space, member } = props;
  const roles = useSpaceRoles(space.id);
  const { user } = useAuth();
  const me = useSpacesStore((state) =>
    state.membersBySpace[space.id]?.find((item) => item.user_id === user?.id),
  );
  const [error, setError] = useState("");
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });
  const custom = (roles ?? []).filter((role) => !role.is_default);
  if (!spaceCan(space, "roles.manage") || !custom.length) return props.children;
  const above = space.role === "owner" || spaceCan(space, "administrator");
  const myTop = Math.max(
    0,
    ...custom.filter((role) => me?.role_ids?.includes(role.id)).map((role) => role.position),
  );
  const toggle = (roleId: string, on: boolean) => {
    const current = member.role_ids ?? [];
    const next = on ? [...new Set([...current, roleId])] : current.filter((id) => id !== roleId);
    void spacesApi
      .setMemberRoles(space.id, member.user_id, next)
      .then(() => useSpacesStore.getState().loadMembers(space.id))
      .catch(() => setError(`${member.name}'s roles couldn't be changed.`));
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{props.children}</DropdownMenuTrigger>
      <DropdownMenuContent side="left" align="start" className="w-56">
        <DropdownMenuLabel>Roles</DropdownMenuLabel>
        {custom.map((role) => (
          <MenuCheckItem
            key={role.id}
            icon={<RoleDot color={role.color} />}
            label={role.name}
            checked={Boolean(member.role_ids?.includes(role.id))}
            disabled={!above && role.position >= myTop}
            reason="Only roles below your own can be given"
            onCheckedChange={(on) => toggle(role.id, on)}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
