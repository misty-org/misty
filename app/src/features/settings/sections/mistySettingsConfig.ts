import type { AiRecapRecord } from "@/features/ai-surface/api";
import type { AiSurfaceId } from "@/features/ai-surface/types";

export const managedSurfaces: Array<{ id: AiSurfaceId; label: string }> = [
  { id: "global", label: "Global Misty" },
  { id: "notes", label: "Notes" },
  { id: "planner.tasks", label: "Planner" },
  { id: "planner.agenda", label: "Agenda" },
  { id: "browser", label: "Browser" },
  { id: "inbox", label: "Inbox" },
  { id: "space.chat", label: "Space Social" },
  { id: "drawings", label: "Drawings" },
  { id: "library", label: "Library" },
  { id: "photo-editor", label: "Photo editor" },
  { id: "code", label: "Code" },
  { id: "terminal", label: "Terminal" },
  { id: "files", label: "Files" },
  { id: "home", label: "Home" },
  { id: "activity", label: "Activity" },
];

export const recapSurfaces: Array<{ id: AiRecapRecord["surface_id"]; label: string }> = [
  { id: "home", label: "Home" },
  { id: "activity", label: "Activity" },
  { id: "global", label: "Global Misty" },
];

export function defaultRecap(surfaceId: AiRecapRecord["surface_id"]): AiRecapRecord {
  return {
    surface_id: surfaceId,
    enabled: false,
    cadence: "daily",
    local_time: "08:00",
    weekday: 1,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    prompt:
      "Summarize recent progress, upcoming commitments, decisions, risks, and blockers. Be concise and omit sections with no grounded evidence.",
    state: "idle",
    last_citations: [],
    updated_at: new Date(0).toISOString(),
  };
}
