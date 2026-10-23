import { expect, it } from "vitest";
import { initialBookmarkNavigation, userBookmarkFolders } from "./navigationDefaults";
import type { SharedRecord } from "./model";

it("starts with user-owned groups only", () => {
  expect(initialBookmarkNavigation().bookmarkFolders).toEqual([]);
});

it("retires empty untouched starters without dropping sites or user changes", () => {
  const starter: SharedRecord<"folder"> = {
    kind: "folder",
    id: "group:default:inbox",
    fields: { label: "Inbox", icon: "mail", order: 0, hidden: false },
  };
  const website: SharedRecord<"bookmark"> = {
    kind: "bookmark",
    id: "site:one",
    fields: {
      title: "Mail",
      url: "https://example.com",
      folder_id: starter.id,
      order: 0,
      pinned: true,
    },
  };
  expect(userBookmarkFolders([starter], [])).toEqual([]);
  expect(userBookmarkFolders([starter], [website])).toEqual([starter]);
  for (const group of [
    { ...starter, id: "group:custom" },
    { ...starter, fields: { ...starter.fields, label: "My inbox" } },
    { ...starter, fields: { ...starter.fields, icon: "star" } },
    { ...starter, fields: { ...starter.fields, order: 3 } },
    { ...starter, fields: { ...starter.fields, hidden: true } },
  ])
    expect(userBookmarkFolders([group], [])).toEqual([group]);
});
