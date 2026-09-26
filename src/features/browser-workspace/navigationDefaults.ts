import type { SharedRecord } from "./model";
// Former starter groups are retired only while their contents and fields are untouched.
const starterGroups = [
  ["inbox", "Inbox", "mail"],
  ["social", "Social", "messages"],
  ["journal", "Journal", "notebook"],
  ["planner", "Planner", "calendar"],
  ["library", "Library", "library"],
] as const;

export function userWebsiteGroups(
  groups: SharedRecord<"group">[],
  websites: SharedRecord<"website">[],
) {
  const occupied = new Set(websites.map((site) => site.fields.group_id));
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

export interface WebsiteNavigationState {
  websiteGroups: SharedRecord<"group">[];
  savedWebsites: SharedRecord<"website">[];
  expandedWebsiteGroups: Record<string, boolean>;
  selectedWebsiteByGroup: Record<string, string>;
}
export function initialWebsiteNavigation(): WebsiteNavigationState {
  return {
    websiteGroups: [],
    savedWebsites: [],
    expandedWebsiteGroups: {},
    selectedWebsiteByGroup: {},
  };
}
