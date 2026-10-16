import type { ComponentProps } from "react";
import { SkeletonList } from "@/shared/ui";
import type { AgendaView } from "./agendaDates";
import { AgendaMonthView, AgendaTimelineView } from "./AgendaViews";

/**
 * The calendar itself. While a refresh the person pressed runs, skeletons shaped like it
 * stand in until it is back; otherwise the month grid or the day and week timeline.
 */
export function AgendaBody({
  refreshing,
  view,
  ...props
}: { refreshing: boolean; view: AgendaView } & Omit<
  ComponentProps<typeof AgendaTimelineView>,
  "view"
>) {
  if (refreshing) return <SkeletonList label="Calendar" rows={10} leading="none" className="p-4" />;
  return view === "month" ? (
    <AgendaMonthView anchor={props.anchor} entries={props.entries} onOpen={props.onOpen} />
  ) : (
    <AgendaTimelineView view={view} {...props} />
  );
}
