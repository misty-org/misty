import type { SpacePermission } from "../api/dto/entities";

export interface PermissionInfo {
  permission: SpacePermission;
  label: string;
  /** One line under the label, as settings rows have. */
  line: string;
}

/** The permissions a role can grant, grouped as the role editor lists them. */
export const permissionGroups: { title: string; permissions: PermissionInfo[] }[] = [
  {
    title: "Space",
    permissions: [
      {
        permission: "administrator",
        label: "Administrator",
        line: "Every permission, in every channel, private ones too.",
      },
      { permission: "space.rename", label: "Manage Space", line: "Its name and picture." },
      {
        permission: "roles.manage",
        label: "Manage roles",
        line: "Make and edit roles below their own, and give them to people.",
      },
      {
        permission: "channels.manage",
        label: "Manage channels",
        line: "Make, rename, delete and make channels private.",
      },
      {
        permission: "space.invite",
        label: "Invite people",
        line: "Send invitations to the Space.",
      },
      {
        permission: "members.remove",
        label: "Remove members",
        line: "Remove people whose roles are below their own.",
      },
      {
        permission: "integrations.manage",
        label: "Manage connected apps",
        line: "The apps connected to the Space.",
      },
    ],
  },
  {
    title: "Channels",
    permissions: [
      { permission: "messages.read", label: "See channels", line: "Read the Space's channels." },
      { permission: "messages.write", label: "Send messages", line: "Write in channels." },
      { permission: "attachments.upload", label: "Attach files", line: "Add files to messages." },
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
      { permission: "library.view", label: "See Media", line: "Open the Space's Media." },
      { permission: "library.add", label: "Add to Media", line: "Upload and save items." },
      { permission: "library.edit", label: "Edit Media", line: "Rename, move and change items." },
      {
        permission: "library.download",
        label: "Download Media",
        line: "Save items to this computer.",
      },
      {
        permission: "library.import",
        label: "Import into Media",
        line: "Bring items in from elsewhere.",
      },
      {
        permission: "library.upload",
        label: "Share folders",
        line: "Upload project folders the Space shares.",
      },
      { permission: "studio.view", label: "Enter the Studio", line: "See the Space's Studio." },
      {
        permission: "ask.run",
        label: "Ask agents",
        line: "Mention their own agents to work here.",
      },
    ],
  },
];
