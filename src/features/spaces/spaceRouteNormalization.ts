import { spaceNotesEnabled } from "@/features/notes";
import { socialProvider, socialProviderFromRoute, socialProviderPath } from "./social/socialRoute";

const validSections = new Set([
  "home",
  "social",
  "planner",
  "notes",
  "drawings",
  "library",
  "settings",
]);
const validSettingsSections = new Set(["general", "members", "connections", "suggestions"]);

/** Returns the one canonical destination for a Space deep link or saved tab route. */
export function canonicalSpaceRoute(route: string): string {
  let parsed: URL;
  try {
    parsed = new URL(route, "https://misty.local");
  } catch {
    return route;
  }
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts[0] !== "spaces" || !parts[1]) return route;

  const encodedSpaceId = parts[1];
  const spaceId = safeDecode(encodedSpaceId);
  const suffix = `${parsed.search}${parsed.hash}`;
  const path = (tail: string) => `/spaces/${encodedSpaceId}/${tail}${suffix}`;
  const section = parts[2] ?? "home";

  if (section === "assistant") return `/agents?spaceId=${encodeURIComponent(spaceId)}`;
  if (section === "files") return path("library");
  if (section === "members") return path("settings/members");
  if (section === "notes" && !spaceNotesEnabled) return path("drawings");
  if (section === "chat") {
    const provider = socialProvider(parsed.searchParams.get("provider")) ?? "misty";
    return `${socialProviderPath(spaceId, provider, parsed.search)}${parsed.hash}`;
  }
  if (section === "social") {
    const provider = socialProviderFromRoute(route);
    return `${socialProviderPath(spaceId, provider, parsed.search)}${parsed.hash}`;
  }
  if (section === "tasks") {
    const view = parts[3] === "list" ? "list" : "board";
    return path(`planner/tasks/${view}`);
  }
  if (section === "planner") {
    const subsection = parts[3] ?? "";
    if (!subsection) return path("planner/tasks/board");
    if (subsection === "board" || subsection === "list") return path(`planner/tasks/${subsection}`);
    if (subsection === "calendar") return path("planner/agenda/month");
    if (subsection === "tasks") {
      const view = parts[4] === "list" ? "list" : "board";
      return path(`planner/tasks/${view}`);
    }
    if (subsection === "agenda") {
      const view = ["month", "week", "day"].includes(parts[4] ?? "") ? parts[4] : "month";
      return path(`planner/agenda/${view}`);
    }
    if (subsection === "goals" || subsection === "milestones") return path("planner/roadmaps");
    if (subsection === "roadmaps") {
      return path(parts[4] ? `planner/roadmaps/${parts[4]}` : "planner/roadmaps");
    }
    return path("planner/tasks/board");
  }
  if (section === "settings") {
    const requested = parts[3] === "integrations" ? "connections" : (parts[3] ?? "general");
    const settingsSection = validSettingsSections.has(requested) ? requested : "general";
    return path(`settings/${settingsSection}`);
  }
  if (!validSections.has(section)) return path(spaceNotesEnabled ? "notes" : "drawings");
  return path([section, ...parts.slice(3)].join("/"));
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
