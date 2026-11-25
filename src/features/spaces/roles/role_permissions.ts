import type { SpacePermission } from "../api/dto/entities";

export interface PermissionInfo {
  permission: SpacePermission;
  label: string;
  line?: string;
}

export const permissionGroups: { title: string; permissions: PermissionInfo[] }[] = [
  {
    title: "Space",
    permissions: [
      {
        permission: "administrator",
        label: "Administrator",
        line: "Every permission, in every channel, private ones too.",
      },
      { permission: "space.rename", label: "Edit the Space" },
      { permission: "roles.manage", label: "Manage roles" },
      { permission: "channels.manage", label: "Manage channels" },
    ],
  },
  {
    title: "People",
    permissions: [
      { permission: "space.invite", label: "Invite people" },
      { permission: "members.remove", label: "Remove people" },
    ],
  },
  {
    title: "Channels",
    permissions: [
      { permission: "messages.read", label: "See channels" },
      { permission: "messages.write", label: "Send messages" },
      { permission: "attachments.upload", label: "Attach files" },
      { permission: "messages.manage", label: "Delete others' messages" },
    ],
  },
  {
    title: "Agents",
    permissions: [{ permission: "ask.run", label: "Ask the Space's agents" }],
  },
];
