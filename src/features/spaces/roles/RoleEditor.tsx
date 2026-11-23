import { useEffect, useState } from "react";
import {
  ChoiceGroup,
  ChoiceList,
  ColorSwatch,
  CustomColorSwatch,
  Input,
  RowGroupStack,
  ScrollArea,
  SettingsRow,
  SettingsSection,
  Switch,
  Text,
  roleColorPresets,
} from "@misty/ui";
import type { RoleInput, SpaceMember, SpaceRoleDef } from "../api/dto/entities";
import { permissionGroups } from "./role_permissions";

type Tab = "display" | "permissions" | "members";

export function RoleEditor(props: {
  role: SpaceRoleDef;
  members: SpaceMember[];
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
            <Text bare as="label" size="meta" tone="muted" weight="medium" className="grid gap-2">
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
                className="grid grid-cols-[repeat(auto-fill,--spacing(5))] gap-2"
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
            <SettingsSection>
              <SettingsRow
                label="Show members separately"
                description="People with this role get their own group in the member list."
              >
                <Switch
                  aria-label="Show members separately"
                  checked={role.hoist}
                  disabled={!props.editable}
                  onCheckedChange={(hoist) => props.onChange({ hoist })}
                />
              </SettingsRow>
              <SettingsRow
                label="Allow anyone to @mention this role"
                description="Everyone with the role is told when it is mentioned."
              >
                <Switch
                  aria-label="Allow anyone to @mention this role"
                  checked={role.mentionable}
                  disabled={!props.editable}
                  onCheckedChange={(mentionable) => props.onChange({ mentionable })}
                />
              </SettingsRow>
            </SettingsSection>
          </div>
        ) : tab === "permissions" ? (
          <RowGroupStack className="pr-2">
            {permissionGroups.map((group) => (
              <SettingsSection key={group.title} title={group.title}>
                {group.permissions.map((info) => (
                  <SettingsRow key={info.permission} label={info.label} description={info.line}>
                    <Switch
                      aria-label={info.label}
                      checked={role.permissions.includes(info.permission)}
                      disabled={!props.editable}
                      onCheckedChange={(on) => toggle(info.permission, on)}
                    />
                  </SettingsRow>
                ))}
              </SettingsSection>
            ))}
          </RowGroupStack>
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
