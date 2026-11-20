/** What a permission lets an app do, as the mod approving it reads it. */
export const permissionLines: Record<string, string> = {
  files: "Open, save and list the Space's files",
  "chat.post": "Post messages and notices in the Space",
  rooms: "Join the Space's live documents",
  records: "Read and change the Space's tasks, events and sources",
  members: "See who is in the Space and who is online",
};

/**
 * The version a built-in app runs at: the one this Misty ships. Misty's own apps are built into every Space
 * and never installed or recorded; only third-party apps are.
 */
export const BUILT_IN_VERSION = "bundled";
