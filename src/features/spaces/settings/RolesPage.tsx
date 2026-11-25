import { ArrowDown, ArrowLeft, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Button,
  ColorSwatch,
  CustomColorSwatch,
  EmptyState,
  IconButton,
  Input,
  ListRow,
  ListRowSkeleton,
  MenuItem,
  PersonRow,
  RoleDot,
  RowGroupSection,
  RowGroupStack,
  SettingsRow,
  SettingsSection,
  Switch,
  Text,
  notify,
  roleColorPresets,
  useConfirmDelete,
} from "@misty/ui";
import { useAuth } from "@/features/account";
import { spacesApi } from "../api/api";
import type { RoleInput, SpaceMember, SpacePermission, SpaceRoleDef } from "../api/dto/entities";
import { useSpacesStore } from "../list/use_spaces_store";
import { permissionGroups } from "../roles/role_permissions";
import { spaceCan, useSpaceRoles, useSpaceRolesStore } from "../roles/use_space_roles";
import { avatarOutline } from "@/shared/lib/avatar_decoration";
import { PersonFace } from "./PersonFace";
import { SpaceSettingsFrame, type SpaceSettingsNav } from "./SpaceSettingsFrame";

function peopleWith(members: SpaceMember[] | undefined, roleId: string) {
  return (members ?? []).filter((member) => member.role_ids?.includes(roleId));
}

function peopleCount(count: number) {
  if (count === 0) return "Nobody yet";
  return count === 1 ? "1 person" : `${count} people`;
}

export function RolesPage({ nav }: { nav: SpaceSettingsNav }) {
  const { space } = nav;
  const roles = useSpaceRoles(space.id);
  const members = useSpacesStore((state) => state.membersBySpace[space.id]);
  const { user } = useAuth();
  const [openId, setOpenId] = useState<string | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirmDelete();

  useEffect(() => {
    if (!members)
      void useSpacesStore
        .getState()
        .loadMembers(space.id)
        .catch(() => undefined);
  }, [members, space.id]);

  const me = members?.find((member) => member.user_id === user?.id);
  const above = space.role === "owner" || spaceCan(space, "administrator");
  const myTop = useMemo(
    () =>
      Math.max(
        0,
        ...(roles ?? [])
          .filter((role) => me?.role_ids?.includes(role.id))
          .map((role) => role.position),
      ),
    [me, roles],
  );
  const editable = (role: SpaceRoleDef) =>
    above || role.position < myTop || (role.is_default && myTop > 0);
  const custom = (roles ?? []).filter((role) => !role.is_default);
  const everyone = (roles ?? []).find((role) => role.is_default);
  const open = (roles ?? []).find((role) => role.id === openId);

  const run = async (work: () => Promise<unknown>, failed: string) => {
    try {
      await work();
    } catch {
      notify({ message: failed, tone: "error" });
    } finally {
      await useSpaceRolesStore
        .getState()
        .load(space.id)
        .catch(() => undefined);
    }
  };
  const update = (role: SpaceRoleDef, input: RoleInput) => {
    useSpaceRolesStore.getState().set(
      space.id,
      (roles ?? []).map((item) => (item.id === role.id ? { ...item, ...input } : item)),
    );
    void run(() => spacesApi.updateRole(space.id, role.id, input), "The role wasn't saved.");
  };
  const create = () =>
    void run(async () => {
      const made = await spacesApi.createRole(space.id, { name: "New role", permissions: [] });
      setOpenId(made.id);
    }, "The role wasn't made. Try again.");
  const move = (role: SpaceRoleDef, by: -1 | 1) => {
    const order = custom.map((item) => item.id);
    const from = order.indexOf(role.id);
    const to = from + by;
    if (to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to]!, order[from]!];
    void run(() => spacesApi.reorderRoles(space.id, order), "The roles weren't reordered.");
  };
  const remove = (role: SpaceRoleDef) =>
    void confirm({
      title: `Delete ${role.name}?`,
      what: "Everyone who has it loses it.",
      onConfirm: async () => {
        await spacesApi.deleteRole(space.id, role.id);
        setOpenId(null);
        await useSpaceRolesStore
          .getState()
          .load(space.id)
          .catch(() => undefined);
      },
    });
  const setMember = (role: SpaceRoleDef, userId: string, has: boolean) => {
    const member = members?.find((item) => item.user_id === userId);
    const current = member?.role_ids ?? [];
    const next = has ? [...new Set([...current, role.id])] : current.filter((id) => id !== role.id);
    void run(async () => {
      await spacesApi.setMemberRoles(space.id, userId, next);
      await useSpacesStore.getState().loadMembers(space.id);
    }, "That person's roles weren't changed.");
  };

  if (open)
    return (
      <SpaceSettingsFrame
        nav={nav}
        title={open.is_default ? "Everyone" : open.name}
        back={
          <IconButton label="Back to roles" onClick={() => setOpenId(null)}>
            <ArrowLeft />
          </IconButton>
        }
      >
        <RoleDetail
          key={open.id}
          role={open}
          members={members}
          editable={editable(open)}
          onChange={(input) => update(open, input)}
          onMember={(userId, has) => setMember(open, userId, has)}
          onDelete={() => remove(open)}
        />
        {confirmDialog}
      </SpaceSettingsFrame>
    );

  return (
    <SpaceSettingsFrame
      nav={nav}
      title="Roles"
      actions={
        spaceCan(space, "roles.manage") ? (
          <Button variant="primary" icon={Plus} onClick={create}>
            New role
          </Button>
        ) : null
      }
    >
      {!roles ? (
        <ListRowSkeleton label="Loading roles" rows={4} />
      ) : (
        <RowGroupStack>
          {everyone ? (
            <RowGroupSection>
              <ListRow
                label="Everyone"
                description="What anyone in the Space may do"
                onOpen={() => setOpenId(everyone.id)}
              />
            </RowGroupSection>
          ) : null}
          {custom.length ? (
            <RowGroupSection title="Roles" count={custom.length}>
              {custom.map((role, index) => (
                <ListRow
                  key={role.id}
                  label={role.name}
                  leading={<RoleDot color={role.color} />}
                  trailing={
                    <Text bare size="meta" tone="muted">
                      {peopleCount(peopleWith(members, role.id).length)}
                    </Text>
                  }
                  onOpen={() => setOpenId(role.id)}
                  menuLabel={`More for ${role.name}`}
                  menu={
                    editable(role) ? (
                      <>
                        {index > 0 ? (
                          <MenuItem
                            icon={ArrowUp}
                            label="Move up"
                            onSelect={() => move(role, -1)}
                          />
                        ) : null}
                        {index < custom.length - 1 ? (
                          <MenuItem
                            icon={ArrowDown}
                            label="Move down"
                            onSelect={() => move(role, 1)}
                          />
                        ) : null}
                        <MenuItem
                          icon={Trash2}
                          label="Delete role"
                          danger
                          onSelect={() => remove(role)}
                        />
                      </>
                    ) : undefined
                  }
                />
              ))}
            </RowGroupSection>
          ) : (
            <EmptyState
              inline
              title="No roles yet"
              line="A role gives the people who have it more they can do."
            />
          )}
        </RowGroupStack>
      )}
      {confirmDialog}
    </SpaceSettingsFrame>
  );
}

function RoleDetail(props: {
  role: SpaceRoleDef;
  members: SpaceMember[] | undefined;
  editable: boolean;
  onChange: (input: RoleInput) => void;
  onMember: (userId: string, has: boolean) => void;
  onDelete: () => void;
}) {
  const { role, editable } = props;
  const toggle = (permission: SpacePermission, on: boolean) =>
    props.onChange({
      permissions: on
        ? [...new Set([...role.permissions, permission])]
        : role.permissions.filter((item) => item !== permission),
    });
  return (
    <RowGroupStack>
      {role.is_default ? null : (
        <>
          <SettingsSection title="Role">
            <RoleName role={role} editable={editable} onChange={props.onChange} />
            <SettingsRow label="Color">
              <div role="radiogroup" aria-label="Role color" className="flex flex-wrap gap-2">
                <ColorSwatch
                  radio
                  color="transparent"
                  label="No color"
                  selected={!role.color}
                  disabled={!editable}
                  onClick={() => props.onChange({ color: "" })}
                />
                {roleColorPresets.map((color) => (
                  <ColorSwatch
                    key={color}
                    radio
                    color={color}
                    label={color}
                    selected={role.color.toLowerCase() === color}
                    disabled={!editable}
                    onClick={() => props.onChange({ color })}
                  />
                ))}
                {editable ? (
                  <CustomColorSwatch
                    label="Any color"
                    value={role.color || roleColorPresets[0]}
                    onChange={(color) => props.onChange({ color })}
                  />
                ) : null}
              </div>
            </SettingsRow>
            <SettingsRow label="Listed apart in the member list">
              <Switch
                aria-label="Listed apart in the member list"
                checked={role.hoist}
                disabled={!editable}
                onCheckedChange={(hoist) => props.onChange({ hoist })}
              />
            </SettingsRow>
            <SettingsRow label="Anyone can @mention it">
              <Switch
                aria-label="Anyone can @mention it"
                checked={role.mentionable}
                disabled={!editable}
                onCheckedChange={(mentionable) => props.onChange({ mentionable })}
              />
            </SettingsRow>
          </SettingsSection>
          <RolePeople
            role={role}
            members={props.members}
            editable={editable}
            onMember={props.onMember}
          />
        </>
      )}
      {permissionGroups.map((group) => (
        <SettingsSection key={group.title} title={group.title}>
          {group.permissions.map((info) => (
            <SettingsRow key={info.permission} label={info.label} description={info.line}>
              <Switch
                aria-label={info.label}
                checked={role.permissions.includes(info.permission)}
                disabled={!editable}
                onCheckedChange={(on) => toggle(info.permission, on)}
              />
            </SettingsRow>
          ))}
        </SettingsSection>
      ))}
      {!role.is_default && editable ? (
        <SettingsSection title="Delete">
          <SettingsRow label="Delete role" description="Everyone who has it loses it.">
            <Button variant="danger" onClick={props.onDelete}>
              Delete role
            </Button>
          </SettingsRow>
        </SettingsSection>
      ) : null}
    </RowGroupStack>
  );
}

function RoleName(props: {
  role: SpaceRoleDef;
  editable: boolean;
  onChange: (input: RoleInput) => void;
}) {
  const [name, setName] = useState(props.role.name);
  useEffect(() => setName(props.role.name), [props.role.name]);
  const save = () => {
    const next = name.trim().slice(0, 64);
    if (next && next !== props.role.name) props.onChange({ name: next });
    else setName(props.role.name);
  };
  return (
    <SettingsRow label="Name">
      <Input
        aria-label="Role name"
        className="w-64"
        maxLength={64}
        value={name}
        disabled={!props.editable}
        onChange={(event) => setName(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </SettingsRow>
  );
}

function RolePeople(props: {
  role: SpaceRoleDef;
  members: SpaceMember[] | undefined;
  editable: boolean;
  onMember: (userId: string, has: boolean) => void;
}) {
  const { role } = props;
  const having = peopleWith(props.members, role.id);
  const others = (props.members ?? []).filter(
    (member) => member.role !== "owner" && !member.role_ids?.includes(role.id),
  );
  return (
    <RowGroupSection
      title="People"
      count={having.length}
      action={
        props.editable && others.length
          ? {
              label: "Add",
              icon: Plus,
              showLabel: true,
              menu: others.map((member) => (
                <MenuItem
                  key={member.user_id}
                  label={member.name}
                  onSelect={() => props.onMember(member.user_id, true)}
                />
              )),
            }
          : undefined
      }
    >
      {having.length ? (
        having.map((member) => (
          <PersonRow
            key={member.user_id}
            face={
              <PersonFace
                id={member.user_id}
                name={member.name}
                pictureVersion={member.avatar_version}
                outline={avatarOutline(member.avatar_decoration)}
              />
            }
            name={member.name}
            tools={
              props.editable ? (
                <IconButton
                  label={`Take ${role.name} from ${member.name}`}
                  onClick={() => props.onMember(member.user_id, false)}
                >
                  <X />
                </IconButton>
              ) : undefined
            }
          />
        ))
      ) : (
        <Text as="p" size="meta" tone="muted" className="px-3 py-2.5">
          Nobody has it yet
        </Text>
      )}
    </RowGroupSection>
  );
}
