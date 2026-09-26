import { expect, it } from "vitest";
import { initialWebsiteNavigation, userWebsiteGroups } from "./navigationDefaults";
import type { SharedRecord } from "./model";

it("starts with user-owned groups only", () => {
  expect(initialWebsiteNavigation().websiteGroups).toEqual([]);
});

it("retires empty untouched starters without dropping sites or user changes", () => {
  const starter: SharedRecord<"group"> = {
    kind: "group",
    id: "group:default:inbox",
    fields: { label: "Inbox", icon: "mail", order: 0, hidden: false },
  };
  const website: SharedRecord<"website"> = {
    kind: "website",
    id: "site:one",
    fields: {
      title: "Mail",
      url: "https://example.com",
      group_id: starter.id,
      order: 0,
      pinned: true,
    },
  };
  expect(userWebsiteGroups([starter], [])).toEqual([]);
  expect(userWebsiteGroups([starter], [website])).toEqual([starter]);
  for (const group of [
    { ...starter, id: "group:custom" },
    { ...starter, fields: { ...starter.fields, label: "My inbox" } },
    { ...starter, fields: { ...starter.fields, icon: "star" } },
    { ...starter, fields: { ...starter.fields, order: 3 } },
    { ...starter, fields: { ...starter.fields, hidden: true } },
  ])
    expect(userWebsiteGroups([group], [])).toEqual([group]);
});
