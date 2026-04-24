import { spaceNotesEnabled } from "@/features/notes/availability";

type PlannerSubpage = "tasks" | "agenda" | "goals" | "milestones" | "roadmaps";
type JournalSubpage = "notes" | "drawings";

interface SpaceSubpageMemory {
  planner?: Partial<Record<PlannerSubpage, string>> & { active?: PlannerSubpage };
  journal?: Partial<Record<JournalSubpage, string>> & { active?: JournalSubpage };
}

export function rememberSpaceSubpageRoute(accountId: string, spaceId: string, route: string) {
  if (!accountId || !spaceId) return;
  const parsed = parseSpaceRoute(spaceId, route);
  if (!parsed) return;
  const current = readMemory(accountId, spaceId);
  if (parsed.section === "planner") {
    current.planner = {
      ...current.planner,
      active: parsed.subpage,
      [parsed.subpage]: route,
    };
  } else {
    current.journal = {
      ...current.journal,
      active: parsed.subpage,
      [parsed.subpage]: route,
    };
  }
  try {
    window.localStorage.setItem(memoryKey(accountId, spaceId), JSON.stringify(current));
  } catch {
    // Route memory is an optional navigation enhancement.
  }
}

export function rememberedPlannerRoute(
  accountId: string,
  spaceId: string,
  subpage?: PlannerSubpage,
) {
  const memory = readMemory(accountId, spaceId).planner;
  const selected = subpage ?? memory?.active ?? "tasks";
  const remembered = memory?.[selected];
  return validRememberedRoute(spaceId, remembered, "planner", selected)
    ? remembered
    : defaultPlannerRoute(spaceId, selected);
}

export function rememberedJournalRoute(
  accountId: string,
  spaceId: string,
  subpage?: JournalSubpage,
) {
  const memory = readMemory(accountId, spaceId).journal;
  const fallback = spaceNotesEnabled ? "notes" : "drawings";
  const selected = subpage ?? memory?.active ?? fallback;
  const available = selected === "notes" && !spaceNotesEnabled ? "drawings" : selected;
  const remembered = memory?.[available];
  return validRememberedRoute(spaceId, remembered, "journal", available)
    ? remembered
    : `/spaces/${encodeURIComponent(spaceId)}/${available}`;
}

function defaultPlannerRoute(spaceId: string, subpage: PlannerSubpage) {
  const base = `/spaces/${encodeURIComponent(spaceId)}/planner`;
  if (subpage === "agenda") return `${base}/agenda/month`;
  if (subpage === "goals") return `${base}/goals`;
  if (subpage === "milestones") return `${base}/milestones`;
  if (subpage === "roadmaps") return `${base}/roadmaps`;
  return `${base}/tasks/board`;
}

function parseSpaceRoute(
  spaceId: string,
  route: string,
):
  | { section: "planner"; subpage: PlannerSubpage }
  | { section: "journal"; subpage: JournalSubpage }
  | undefined {
  try {
    const parsed = new URL(route, "https://misty.local");
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts[0] !== "spaces" || decodeURIComponent(parts[1] ?? "") !== spaceId) return undefined;
    if (parts[2] === "planner") {
      const subpage = parts[3];
      if (
        subpage === "tasks" ||
        subpage === "agenda" ||
        subpage === "goals" ||
        subpage === "milestones" ||
        subpage === "roadmaps"
      ) {
        return { section: "planner" as const, subpage };
      }
    }
    if (parts[2] === "notes" || parts[2] === "drawings") {
      return { section: "journal" as const, subpage: parts[2] };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function validRememberedRoute(
  spaceId: string,
  route: string | undefined,
  section: "planner" | "journal",
  subpage: PlannerSubpage | JournalSubpage,
): route is string {
  const parsed = route ? parseSpaceRoute(spaceId, route) : undefined;
  return parsed?.section === section && parsed.subpage === subpage;
}

function readMemory(accountId: string, spaceId: string): SpaceSubpageMemory {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(memoryKey(accountId, spaceId)) ?? "{}",
    ) as SpaceSubpageMemory;
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function memoryKey(accountId: string, spaceId: string) {
  return `misty:space-subpage-memory:${accountId}:${spaceId}`;
}
