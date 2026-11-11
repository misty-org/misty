import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Switch,
  Textarea,
} from "@/shared/ui";
import { useState, type FormEvent } from "react";
import type { SpaceCalendarEvent, SpaceCalendarEventInput } from "../planner/api";
import { clockField, eventDayKey, eventTimes } from "./calendarDates";

/** One event of the Space's calendar, new (on `day`) or open for editing. */
export function CalendarEventDialog(props: {
  event: SpaceCalendarEvent | null;
  day: string;
  busy: boolean;
  onClose(): void;
  /** Resolves true once the event is saved. */
  onSave(input: SpaceCalendarEventInput): Promise<boolean>;
  onDelete?(): void;
}) {
  const { event } = props;
  const [title, setTitle] = useState(event?.title ?? "");
  const [day, setDay] = useState(event ? eventDayKey(event) : props.day);
  const [allDay, setAllDay] = useState(event?.all_day ?? false);
  const [start, setStart] = useState(
    event && !event.all_day ? clockField(event.starts_at) : "09:00",
  );
  const [end, setEnd] = useState(event && !event.all_day ? clockField(event.ends_at) : "10:00");
  const [location, setLocation] = useState(event?.location ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const times = eventTimes(day, allDay, start, end);

  const save = async (submit: FormEvent) => {
    submit.preventDefault();
    if (!title.trim() || !times || props.busy) return;
    const saved = await props.onSave({
      title: title.trim(),
      description,
      location: location.trim(),
      all_day: allDay,
      // An all-day event keeps the zone it was first made in, so its day does not move.
      timezone:
        (event?.all_day && allDay && event.timezone) ||
        Intl.DateTimeFormat().resolvedOptions().timeZone ||
        "UTC",
      ...times,
    });
    if (saved) props.onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !props.busy && props.onClose()}>
      <DialogContent className="sm:max-w-md">
        <form className="grid gap-4" onSubmit={(submit) => void save(submit)}>
          <DialogHeader>
            <DialogTitle>{event ? "Event" : "New event"}</DialogTitle>
          </DialogHeader>
          <Field label="Title">
            <Input
              autoFocus
              required
              maxLength={240}
              value={title}
              onChange={(change) => setTitle(change.target.value)}
            />
          </Field>
          <Field label="Date">
            <Input
              type="date"
              required
              value={day}
              onChange={(change) => setDay(change.target.value)}
            />
          </Field>
          <Field label="All day" layout="inline">
            <Switch checked={allDay} onCheckedChange={setAllDay} />
          </Field>
          {allDay ? null : (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Starts">
                <Input
                  type="time"
                  required
                  value={start}
                  onChange={(change) => setStart(change.target.value)}
                />
              </Field>
              <Field label="Ends">
                <Input
                  type="time"
                  required
                  value={end}
                  onChange={(change) => setEnd(change.target.value)}
                />
              </Field>
            </div>
          )}
          <Field label="Location">
            <Input
              maxLength={500}
              value={location}
              onChange={(change) => setLocation(change.target.value)}
            />
          </Field>
          <Field label="Description">
            <Textarea
              rows={3}
              maxLength={20000}
              className="max-h-48 overflow-y-auto"
              value={description}
              onChange={(change) => setDescription(change.target.value)}
            />
          </Field>
          <DialogFooter className="sm:justify-between">
            {props.onDelete ? (
              <Button type="button" variant="ghost" disabled={props.busy} onClick={props.onDelete}>
                Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" disabled={props.busy} onClick={props.onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={!title.trim() || !times || props.busy}>
                {event ? "Save" : "Create"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
