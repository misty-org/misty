import type { SharedRecord } from "./model";
// Former starter groups are retired only while their contents and fields are untouched.
const starterGroups = [
  ["inbox", "Inbox", "mail"],
  ["social", "Social", "messages"],
  ["journal", "Journal", "notebook"],
  ["planner", "Planner", "calendar"],
  ["library", "Library", "library"],
] as const;

export function userBookmarkFolders(
  groups: SharedRecord<"folder">[],
  websites: SharedRecord<"bookmark">[],
) {
  const occupied = new Set(websites.map((site) => site.fields.folder_id));
  return groups.filter(
    (group) =>
      !starterGroups.some(
        ([id, label, icon], order) =>
          group.id === `group:default:${id}` &&
          group.fields.label === label &&
          group.fields.icon === icon &&
          group.fields.order === order &&
          !group.fields.hidden &&
          !occupied.has(group.id),
      ),
  );
}

export interface BookmarkNavigationState {
  bookmarkFolders: SharedRecord<"folder">[];
  bookmarks: SharedRecord<"bookmark">[];
  expandedBookmarkFolders: Record<string, boolean>;
  selectedBookmarkByFolder: Record<string, string>;
}
export function initialBookmarkNavigation(): BookmarkNavigationState {
  return {
    bookmarkFolders: [],
    bookmarks: [],
    expandedBookmarkFolders: {},
    selectedBookmarkByFolder: {},
  };
}
