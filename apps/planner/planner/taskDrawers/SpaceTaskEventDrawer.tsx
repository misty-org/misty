import type { SpaceCalendarEvent } from "@/api/spaces/dto/interfaces/types";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Textarea,
} from "@/shared/ui";
import { CalendarDays, Clock3, ExternalLink, LoaderCircle, Trash2, UserRound } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";

type EventDraft = {
  title: string;
  description: string;
  location: string;
  starts: string;
  ends: string;
  allDay: boolean;
  timezone: string;
};

/** Editable detail for native events and read-only detail for synced provider events. */
export function SpaceTaskEventDrawer({
  event,
  busy,
  canManage,
  error,
  onClose,
  onDelete,
  onSave,
}: {
  event: SpaceCalendarEvent;
  busy: boolean;
  canManage: boolean;
  error?: string;
  onClose: () => void;
  onDelete: () => void;
  onSave: (event: SpaceCalendarEvent) => void;
}) {
  const editable = canManage && event.provider === "misty";
  const [draft, setDraft] = useState<EventDraft>(() => eventDraft(event));
  const startsAt = draftDate(draft.starts, draft.allDay);
  const endsAt = draftDate(draft.ends, draft.allDay);
  const datesValid = Boolean(startsAt && endsAt && endsAt > startsAt);

  const submit = (formEvent: FormEvent) => {
    formEvent.preventDefault();
    if (!editable || busy || !draft.title.trim() || !datesValid) return;
    onSave({
      ...event,
      title: draft.title.trim(),
      description: draft.description.trim(),
      location: draft.location.trim(),
      starts_at: startsAt!.toISOString(),
      ends_at: endsAt!.toISOString(),
      all_day: draft.allDay,
      timezone: draft.timezone.trim() || "UTC",
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="w-[min(560px,calc(100vw-2rem))] max-w-[560px] gap-0 overflow-hidden rounded-2xl border border-charcoal-border bg-charcoal-card p-0 shadow-xl ring-0">
        {editable ? (
          <form onSubmit={submit}>
            <DialogHeader className="border-b border-charcoal-border px-6 py-5 pr-14 text-left">
              <DialogTitle>Edit event</DialogTitle>
              <DialogDescription>Update this native Misty event.</DialogDescription>
            </DialogHeader>

            <div className="grid max-h-[min(620px,calc(100dvh-13rem))] gap-4 overflow-y-auto px-6 py-5">
              <EventField label="Title">
                <Input
                  autoFocus
                  required
                  maxLength={240}
                  aria-label="Event title"
                  value={draft.title}
                  onChange={(inputEvent) =>
                    setDraft((current) => ({ ...current, title: inputEvent.target.value }))
                  }
                />
              </EventField>

              <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
                <EventField label="Starts">
                  <Input
                    type={draft.allDay ? "date" : "datetime-local"}
                    aria-label="Event starts"
                    value={draft.starts}
                    onChange={(inputEvent) =>
                      setDraft((current) => ({ ...current, starts: inputEvent.target.value }))
                    }
                  />
                </EventField>
                <EventField label="Ends">
                  <Input
                    type={draft.allDay ? "date" : "datetime-local"}
                    aria-label="Event ends"
                    aria-invalid={Boolean(draft.starts && draft.ends && !datesValid)}
                    value={draft.ends}
                    onChange={(inputEvent) =>
                      setDraft((current) => ({ ...current, ends: inputEvent.target.value }))
                    }
                  />
                </EventField>
              </div>

              {draft.starts && draft.ends && !datesValid ? (
                <p className="-mt-2 m-0 text-xs text-cream-bright" role="alert">
                  End time must be after start time.
                </p>
              ) : null}

              <label className="flex min-h-9 items-center gap-2 text-xs font-medium text-cream-muted">
                <Checkbox
                  checked={draft.allDay}
                  onCheckedChange={(checked) =>
                    setDraft((current) => switchAllDay(current, Boolean(checked)))
                  }
                />
                All-day event
              </label>

              <EventField label="Timezone">
                <Input
                  aria-label="Event timezone"
                  value={draft.timezone}
                  onChange={(inputEvent) =>
                    setDraft((current) => ({ ...current, timezone: inputEvent.target.value }))
                  }
                />
              </EventField>

              <EventField label="Location">
                <Input
                  maxLength={1000}
                  aria-label="Event location"
                  value={draft.location}
                  onChange={(inputEvent) =>
                    setDraft((current) => ({ ...current, location: inputEvent.target.value }))
                  }
                />
              </EventField>

              <EventField label="Description">
                <Textarea
                  className="min-h-24 resize-y"
                  maxLength={20000}
                  aria-label="Event description"
                  value={draft.description}
                  onChange={(inputEvent) =>
                    setDraft((current) => ({ ...current, description: inputEvent.target.value }))
                  }
                />
              </EventField>

              {error ? (
                <p
                  className="m-0 rounded-md border border-charcoal-border bg-charcoal-bg px-3 py-2 text-sm text-cream-bright"
                  role="alert"
                >
                  The event could not be changed. {error}
                </p>
              ) : null}
            </div>

            <DialogFooter className="flex-row items-center justify-between border-t border-charcoal-border px-6 py-4 sm:space-x-0">
              <Button type="button" variant="destructive" disabled={busy} onClick={onDelete}>
                <Trash2 className="size-4" />
                Delete event
              </Button>
              <div className="ml-auto flex items-center gap-2">
                <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" disabled={busy || !draft.title.trim() || !datesValid}>
                  {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                  {busy ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </DialogFooter>
          </form>
        ) : (
          <ReadOnlyEvent event={event} canManage={canManage} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReadOnlyEvent({ event, canManage }: { event: SpaceCalendarEvent; canManage: boolean }) {
  const organizer =
    typeof event.organizer?.email === "string"
      ? event.organizer.email
      : typeof event.organizer?.displayName === "string"
        ? event.organizer.displayName
        : "";
  const description =
    event.provider === "misty" && !canManage
      ? "You can view this event, but you don’t have permission to change it."
      : "This synced calendar event is read-only in Misty.";

  return (
    <>
      <DialogHeader className="border-b border-charcoal-border px-6 py-5 pr-14 text-left">
        <DialogTitle>{event.title || "Busy"}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 px-6 py-5">
        <EventFact
          icon={Clock3}
          value={`${formatEventDate(event.starts_at, event.all_day)} – ${formatEventDate(event.ends_at, event.all_day)}`}
        />
        {event.location ? <EventFact icon={CalendarDays} value={event.location} /> : null}
        {organizer ? <EventFact icon={UserRound} value={organizer} /> : null}
        {event.description ? (
          <p className="m-0 whitespace-pre-wrap break-words text-sm leading-6 text-cream-muted">
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
    </>
  );
}

function EventField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid min-w-0 gap-1.5 text-xs font-medium text-cream-muted">
      {label}
      {children}
    </label>
  );
}

function EventFact({ icon: Icon, value }: { icon: typeof Clock3; value: string }) {
  return (
    <div className="flex min-w-0 items-start gap-3 text-sm text-cream-muted">
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 break-words">{value}</span>
    </div>
  );
}

function eventDraft(event: SpaceCalendarEvent): EventDraft {
  return {
    title: event.title,
    description: event.description,
    location: event.location,
    starts: eventInputDate(event.starts_at, event.all_day),
    ends: eventInputDate(event.ends_at, event.all_day),
    allDay: event.all_day,
    timezone: event.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };
}

function switchAllDay(draft: EventDraft, allDay: boolean): EventDraft {
  if (draft.allDay === allDay) return draft;
  const startDate = draft.starts.slice(0, 10);
  const endDate = draft.ends.slice(0, 10);
  return {
    ...draft,
    allDay,
    starts: allDay ? startDate : `${startDate}T09:00`,
    ends: allDay ? (endDate > startDate ? endDate : nextDayInput(startDate)) : `${endDate}T10:00`,
  };
}

function nextDayInput(value: string) {
  const next = new Date(`${value}T12:00:00`);
  next.setDate(next.getDate() + 1);
  const offset = next.getTimezoneOffset() * 60_000;
  return new Date(next.getTime() - offset).toISOString().slice(0, 10);
}

function draftDate(value: string, allDay: boolean): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(allDay ? `${value}T00:00:00` : value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function eventInputDate(value: string, allDay: boolean) {
  if (allDay) return value.slice(0, 10);
  const parsed = new Date(value);
  const offset = parsed.getTimezoneOffset() * 60_000;
  return new Date(parsed.getTime() - offset).toISOString().slice(0, 16);
}

function formatEventDate(value: string, allDay: boolean) {
  return new Date(value).toLocaleString(
    [],
    allDay
      ? { month: "short", day: "numeric", year: "numeric" }
      : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
  );
}
