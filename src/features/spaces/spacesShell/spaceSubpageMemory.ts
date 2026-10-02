import { readDeploymentStorageItem } from "@/api/deployment/api";

type PlannerSubpage = "tasks" | "agenda" | "roadmaps";
type JournalSubpage = "notes" | "drawings";

interface SpaceSubpageMemory {
  planner?: Partial<Record<PlannerSubpage, string>> & { active?: PlannerSubpage };
  journal?: Partial<Record<JournalSubpage, string>> & { active?: JournalSubpage };
}

export function rememberedJournalRoute(
  accountId: string,
  spaceId: string,
  subpage?: JournalSubpage,
) {
  const memory = readMemory(accountId, spaceId).journal;
  const selected = subpage ?? memory?.active ?? "notes";
  const remembered = memory?.[selected];
  return validRememberedRoute(spaceId, remembered, "journal", selected)
    ? remembered
    : `/spaces/${encodeURIComponent(spaceId)}/${selected}`;
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
      if (subpage === "tasks" || subpage === "agenda" || subpage === "roadmaps")
        return { section: "planner" as const, subpage };
      if (subpage === "goals" || subpage === "milestones")
        return { section: "planner" as const, subpage: "roadmaps" as const };
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
      readDeploymentStorageItem(memoryKey(accountId, spaceId)) ?? "{}",
    ) as SpaceSubpageMemory;
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function memoryKey(accountId: string, spaceId: string) {
  return `misty:space-subpage-memory:${accountId}:${spaceId}`;
}
