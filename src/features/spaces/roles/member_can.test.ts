import { afterEach, expect, it } from "vitest";
import type { Space, SpaceMember, SpaceRoleDef } from "../api/dto/entities";
import { useSpacesStore } from "../list/use_spaces_store";
import { memberCan, useSpaceRolesStore } from "./use_space_roles";

const member = (user_id: string, role_ids: string[] = []) =>
  ({ space_id: "sp", user_id, role: "member", role_ids }) as unknown as SpaceMember;

const role = (id: string, permissions: string[], is_default = false) =>
  ({ id, space_id: "sp", permissions, is_default, position: 1 }) as unknown as SpaceRoleDef;

afterEach(() => {
  useSpacesStore.setState({ spaces: [], membersBySpace: {} });
  useSpaceRolesStore.setState({ bySpace: {} });
});

it("lets the owner, an administrator and a role that grants the permission through", () => {
  useSpacesStore.setState({
    spaces: [{ id: "sp", owner_user_id: "owner" } as unknown as Space],
    membersBySpace: {
      sp: [member("mod", ["moderators"]), member("admin", ["admins"]), member("plain")],
    },
  });
  useSpaceRolesStore.setState({
    bySpace: {
      sp: [
        role("everyone", ["messages.read"], true),
        role("moderators", ["members.remove"]),
        role("admins", ["administrator"]),
      ],
    },
  });
  expect(memberCan("sp", "owner", "members.remove")).toBe(true);
  expect(memberCan("sp", "mod", "members.remove")).toBe(true);
  expect(memberCan("sp", "admin", "members.remove")).toBe(true);
  expect(memberCan("sp", "plain", "members.remove")).toBe(false);
  expect(memberCan("sp", "plain", "messages.read")).toBe(true);
  expect(memberCan("sp", "stranger", "messages.read")).toBe(false);
});
