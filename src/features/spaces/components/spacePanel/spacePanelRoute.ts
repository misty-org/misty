import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { spaceNotesEnabled } from "@/features/notes/availability";

const validSections = new Set([
  "chat",
  "planner",
  "notes",
  "drawings",
  "library",
  "members",
  "settings",
]);
const validSettingsSections = new Set(["general", "members", "connections", "suggestions"]);

export interface SpacePanelRoute {
  activeSpaceId: string;
  section: string;
  plannerSection: "tasks" | "agenda" | "goals" | "milestones" | "roadmaps";
  taskView: string;
  agendaView: "month" | "week" | "day";
  roadmapId: string;
  settingsSection: string;
  libraryCollection: string;
  conversationId: string | null;
  drawingId: string;
}

/**
 * Reads the Space panel's position out of the URL.
 *
 * The panel is driven entirely by the route, so every section, settings tab and
 * Library collection is derived here rather than mirrored into local state.
 */
export function useSpacePanelRoute(): SpacePanelRoute {
  const location = useLocation();
  const search = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const routeParts = location.pathname.split("/").filter(Boolean);
  const defaultJournalSection = spaceNotesEnabled ? "notes" : "drawings";
  const requestedSection = routeParts[2] ?? defaultJournalSection;
  const routeSection =
    requestedSection === "files"
      ? "library"
      : requestedSection === "tasks"
        ? "planner"
        : requestedSection;
  const requestedSettingsSection =
    routeParts[3] === "integrations" ? "connections" : (routeParts[3] ?? "");

  const plannerPart = routeParts[3] ?? "";
  const plannerSection =
    plannerPart === "agenda" || plannerPart === "calendar"
      ? "agenda"
      : plannerPart === "goals" || plannerPart === "milestones" || plannerPart === "roadmaps"
        ? plannerPart
        : "tasks";
  const legacyTaskView = plannerPart === "board" || plannerPart === "list" ? plannerPart : "";
  const canonicalTaskView = plannerPart === "tasks" ? (routeParts[4] ?? "") : "";
  const agendaCandidate = plannerPart === "agenda" ? (routeParts[4] ?? "month") : "month";

  return {
    activeSpaceId: routeParts[0] === "spaces" ? decodeRouteSegment(routeParts[1] ?? "") : "",
    section: validSections.has(routeSection) ? routeSection : defaultJournalSection,
    plannerSection,
    taskView:
      routeSection === "planner" && ["board", "list"].includes(canonicalTaskView || legacyTaskView)
        ? canonicalTaskView || legacyTaskView
        : "board",
    agendaView: ["month", "week", "day"].includes(agendaCandidate)
      ? (agendaCandidate as "month" | "week" | "day")
      : "month",
    roadmapId:
      routeSection === "planner" && plannerPart === "roadmaps"
        ? decodeRouteSegment(routeParts[4] ?? "")
        : "",
    settingsSection: validSettingsSections.has(requestedSettingsSection)
      ? requestedSettingsSection
      : "general",
    libraryCollection: search.get("collection") ?? "recent",
    conversationId: search.get("conversation"),
    drawingId: routeSection === "drawings" ? decodeRouteSegment(routeParts[3] ?? "") : "",
  };
}

export function spaceSectionPath(spaceId: string, section: string, settingsSection: string) {
  const destination = section === "settings" ? `settings/${settingsSection}` : section;
  return `/spaces/${encodeURIComponent(spaceId)}/${destination}`;
}

export function spaceConversationPath(spaceId: string, conversationId: string) {
  return `/spaces/${encodeURIComponent(spaceId)}/chat?conversation=${encodeURIComponent(conversationId)}`;
}

function decodeRouteSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}
