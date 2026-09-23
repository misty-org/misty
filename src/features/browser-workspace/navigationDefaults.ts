import type { SharedRecord } from "./model";
export function defaultWebsiteGroups(): SharedRecord<"group">[] {
  return [
    ["inbox", "Inbox", "mail"],
    ["social", "Social", "messages"],
    ["journal", "Journal", "notebook"],
    ["planner", "Planner", "calendar"],
    ["library", "Library", "library"],
  ].map(([id, label, icon], order) => ({
    kind: "group",
    id: `group:default:${id}`,
    fields: { label, icon, order, hidden: false },
  }));
}
export interface WebsiteNavigationState {
  websiteGroups: SharedRecord<"group">[];
  savedWebsites: SharedRecord<"website">[];
  expandedWebsiteGroups: Record<string, boolean>;
  selectedWebsiteByGroup: Record<string, string>;
}
export function initialWebsiteNavigation(): WebsiteNavigationState {
  return {
    websiteGroups: defaultWebsiteGroups(),
    savedWebsites: [],
    expandedWebsiteGroups: {},
    selectedWebsiteByGroup: {},
  };
}
