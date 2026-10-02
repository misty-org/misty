import type { AiSurfaceAdapter } from "@/features/ai-surface/types";
import { agendaTitle, type AgendaView } from "./agendaDates";

/** What the AI pane sees and offers while an agenda range is open. */
export function agendaAiAdapter({
  anchor,
  view,
  spaceId,
  href,
  range,
}: {
  anchor: Date;
  view: AgendaView;
  spaceId: string;
  href: string;
  range: { from: Date; to: Date };
}): AiSurfaceAdapter {
  return {
    surfaceId: "planner.agenda",
    label: `${agendaTitle(anchor, view)} agenda`,
    getContext: () => [
      {
        kind: "agenda.range",
        id: spaceId,
        title: `${agendaTitle(anchor, view)} visible agenda`,
        privacy: "shared",
        spaceId,
        href,
        metadata: {
          from: range.from.toISOString(),
          to: range.to.toISOString(),
          view,
        },
      },
    ],
    getSuggestedActions: () => [
      {
        id: "agenda-brief",
        label: "Brief me",
        prompt:
          "Brief me on this visible agenda range, highlighting deadlines, meetings, and preparation needs.",
      },
      {
        id: "conflicts",
        label: "Find conflicts",
        prompt:
          "Find scheduling conflicts, risky clustering, and missing preparation time in this visible range.",
      },
      {
        id: "week-plan",
        label: "Plan the range",
        prompt:
          "Suggest a realistic plan for this agenda range without changing any events or tasks.",
      },
      {
        id: "schedule-event",
        label: "Draft event",
        prompt:
          "Propose one native Misty calendar event for this Space. Use explicit dates and timezone, and do not add invitees.",
        requestedArtifactKind: "calendar_event",
      },
      {
        id: "agenda-tasks",
        label: "Preparation tasks",
        prompt:
          "Propose a reviewed set of preparation tasks for the visible agenda. Do not schedule or assign them.",
        requestedArtifactKind: "task_set",
      },
    ],
  };
}
