import type { SpaceCalendarEvent } from "@/api/spaces/dto/interfaces/types";
import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui";
import { CalendarDays, Clock3, ExternalLink, UserRound } from "lucide-react";

/** Read-only detail for an event published from an external calendar. */
export function SpaceTaskEventDrawer({
  event,
  onClose,
}: {
  event: SpaceCalendarEvent;
  onClose: () => void;
}) {
  const organizer =
    typeof event.organizer?.email === "string"
      ? event.organizer.email
      : typeof event.organizer?.displayName === "string"
        ? event.organizer.displayName
        : "";

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-[min(460px,96vw)] bg-charcoal-bg sm:max-w-[460px]">
        <SheetHeader className="pr-8 text-left">
          <SheetTitle>{event.title || "Busy"}</SheetTitle>
          <SheetDescription>Event details shared with this Space.</SheetDescription>
        </SheetHeader>
        <div className="mt-6 grid gap-4">
          <EventFact
            icon={Clock3}
            value={`${formatEventDate(event.starts_at, event.all_day)} – ${formatEventDate(event.ends_at, event.all_day)}`}
          />
          {event.location ? <EventFact icon={CalendarDays} value={event.location} /> : null}
          {organizer ? <EventFact icon={UserRound} value={organizer} /> : null}
          {event.description ? (
            <p className="m-0 whitespace-pre-wrap text-sm leading-6 text-cream-muted">
              {event.description}
            </p>
          ) : null}
          {event.meeting_url ? (
            <Button asChild className="w-fit" variant="outline">
              <a href={event.meeting_url} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" /> Join meeting
              </a>
            </Button>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function EventFact({ icon: Icon, value }: { icon: typeof Clock3; value: string }) {
  return (
    <div className="flex items-start gap-3 text-sm text-cream-muted">
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span>{value}</span>
    </div>
  );
}

function formatEventDate(value: string, allDay: boolean) {
  return new Date(value).toLocaleString(
    [],
    allDay
      ? { month: "short", day: "numeric", year: "numeric" }
      : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
  );
}
