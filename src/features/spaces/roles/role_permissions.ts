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
      { permission: "space.rename", label: "Manage Space" },
      { permission: "roles.manage", label: "Manage roles" },
      { permission: "channels.manage", label: "Manage channels" },
      { permission: "space.invite", label: "Invite people" },
      { permission: "members.remove", label: "Remove members" },
      { permission: "integrations.manage", label: "Manage connected apps" },
      {
        permission: "apps.manage",
        label: "Manage apps",
        line: "Install and remove the Space's apps.",
      },
    ],
  },
  {
    title: "Channels",
    permissions: [
      { permission: "messages.read", label: "See channels" },
      { permission: "messages.write", label: "Send messages" },
      { permission: "attachments.upload", label: "Attach files" },
      {
        permission: "messages.manage",
        label: "Manage messages",
        line: "Delete other people's messages.",
      },
    ],
  },
  {
    title: "Space content",
    permissions: [
      { permission: "studio.view", label: "Enter the Studio" },
      { permission: "ask.run", label: "Ask agents" },
    ],
  },
];
