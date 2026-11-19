import { useEffect, useState } from "react";
import {
  ChoiceGroup,
  ChoiceList,
  ColorSwatch,
  CustomColorSwatch,
  Input,
  ScrollArea,
  Switch,
  Text,
  roleColorPresets,
} from "@/shared/ui";
import type { RoleInput, SpaceMember, SpaceRoleDef } from "../api/dto/entities";
import { permissionGroups } from "./rolePermissions";

type Tab = "display" | "permissions" | "members";

/**
 * One role's settings, after Discord's: how it looks (name, color, shown on its own in the
 * member list), what it allows, and who has it. Every change saves itself.
 */
export function RoleEditor(props: {
  role: SpaceRoleDef;
  members: SpaceMember[];
  /** False for a role at or above the person's own: it shows, but nothing changes. */
  editable: boolean;
  onChange: (input: RoleInput) => void;
  onMembers: (userId: string, has: boolean) => void;
}) {
  const { role } = props;
  const [tab, setTab] = useState<Tab>("display");
  const [name, setName] = useState(role.name);
  useEffect(() => setName(role.name), [role.id, role.name]);
  useEffect(() => {
    if (role.is_default && tab !== "permissions") setTab("permissions");
  }, [role.is_default, tab]);
  const saveName = () => {
    const next = name.trim().slice(0, 64);
    if (next && next !== role.name) props.onChange({ name: next });
    else setName(role.name);
  };
  const toggle = (permission: SpaceRoleDef["permissions"][number], on: boolean) =>
    props.onChange({
      permissions: on
        ? [...new Set([...role.permissions, permission])]
        : role.permissions.filter((item) => item !== permission),
    });

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
      {role.is_default ? (
        <Text as="p" size="meta" tone="muted" wrap>
          What everyone in the Space may do, whatever other roles they have.
        </Text>
      ) : (
        <ChoiceGroup
          label="Role settings"
          value={tab}
          options={[
            { value: "display", label: "Display" },
            { value: "permissions", label: "Permissions" },
            { value: "members", label: `Members (${countWith(props.members, role.id)})` },
          ]}
          onChange={setTab}
        />
      )}
      <ScrollArea className="min-h-0 flex-1">
        {tab === "display" ? (
          <div className="flex flex-col gap-5 pr-2">
            <Text bare as="label" tone="muted" weight="medium" className="grid gap-2 text-meta">
              Role name
              <Input
                value={name}
                maxLength={64}
                disabled={!props.editable}
                onChange={(event) => setName(event.target.value)}
                onBlur={saveName}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
            </Text>
            <div className="grid gap-2">
              <Text size="meta" tone="muted" weight="medium">
                Role color
              </Text>
              <div
                role="radiogroup"
                aria-label="Role color"
                // A palette: even columns of 20px swatches, as many as the width holds.
                className="grid grid-cols-[repeat(auto-fill,1.25rem)] gap-2"
              >
                <ColorSwatch
                  radio
                  color="transparent"
                  label="No color"
                  selected={!role.color}
                  disabled={!props.editable}
                  onClick={() => props.onChange({ color: "" })}
                />
                {roleColorPresets.map((color) => (
                  <ColorSwatch
                    key={color}
                    radio
                    color={color}
                    label={color}
                    selected={role.color.toLowerCase() === color}
                    disabled={!props.editable}
                    onClick={() => props.onChange({ color })}
                  />
                ))}
                {props.editable ? (
                  <CustomColorSwatch
                    label="Any color"
                    value={role.color || "#a0c4d4"}
                    onChange={(color) => props.onChange({ color })}
                  />
                ) : null}
              </div>
            </div>
            <SettingSwitch
              label="Show members separately"
              line="People with this role get their own group in the member list."
              checked={role.hoist}
              disabled={!props.editable}
              onChange={(hoist) => props.onChange({ hoist })}
            />
            <SettingSwitch
              label="Allow anyone to @mention this role"
              line="Everyone with the role is told when it is mentioned."
              checked={role.mentionable}
              disabled={!props.editable}
              onChange={(mentionable) => props.onChange({ mentionable })}
            />
          </div>
        ) : tab === "permissions" ? (
          <div className="flex flex-col gap-6 pr-2">
            {permissionGroups.map((group) => (
              <section key={group.title} className="flex flex-col gap-4">
                <Text as="h3" size="meta" tone="muted" weight="semibold">
                  {group.title}
                </Text>
                {group.permissions.map((info) => (
                  <SettingSwitch
                    key={info.permission}
                    label={info.label}
                    line={info.line}
                    checked={role.permissions.includes(info.permission)}
                    disabled={!props.editable}
                    onChange={(on) => toggle(info.permission, on)}
                  />
                ))}
              </section>
            ))}
          </div>
        ) : (
          <ChoiceList
            label={`People with ${role.name}`}
            multiple
            disabled={!props.editable}
            options={props.members.map((member) => ({ value: member.user_id, label: member.name }))}
            selected={props.members
              .filter((member) => member.role_ids?.includes(role.id))
              .map((member) => member.user_id)}
            onSelect={(userId) => {
              const member = props.members.find((item) => item.user_id === userId);
              props.onMembers(userId, !member?.role_ids?.includes(role.id));
            }}
          />
        )}
      </ScrollArea>
    </div>
  );
}

function countWith(members: SpaceMember[], roleId: string) {
  return members.filter((member) => member.role_ids?.includes(roleId)).length;
}

/** A settings row: what it is and one line on what it does, with its switch at the end. */
function SettingSwitch(props: {
  label: string;
  line: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4">
      <span className="flex min-w-0 flex-col gap-0.5">
        <Text size="control" tone="default" weight="medium" wrap>
          {props.label}
        </Text>
        <Text size="meta" tone="muted" wrap>
          {props.line}
        </Text>
      </span>
      <Switch checked={props.checked} disabled={props.disabled} onCheckedChange={props.onChange} />
    </label>
  );
}
