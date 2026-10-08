export const historySections = [
  { value: "all", label: "All" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "older", label: "Older" },
  { value: "archived", label: "Archived" },
] as const;

export type HistorySection = (typeof historySections)[number]["value"];

export function historySectionRange(section: HistorySection, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
  switch (section) {
    case "today":
      return { since: today, before: undefined };
    case "yesterday":
      return { since: yesterday, before: today };
    case "older":
      return { since: undefined, before: yesterday };
    default:
      return { since: undefined, before: undefined };
  }
}
