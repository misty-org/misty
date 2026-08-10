import type { SpaceCalendarEvent } from "@/services/spaces/dto/interfaces/types";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@/shared/ui";
import { useCallback, useEffect, useState } from "react";

type CalendarEventInput = Pick<
  SpaceCalendarEvent,
  "title" | "description" | "location" | "starts_at" | "ends_at" | "all_day" | "timezone"
>;

export function NewCalendarEventDialog({
  open,
  anchor,
  busy,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  anchor: Date;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: CalendarEventInput) => void;
}) {
  const initial = useCallback(() => {
    const starts = new Date(anchor);
    starts.setHours(9, 0, 0, 0);
    const ends = new Date(starts.getTime() + 60 * 60 * 1000);
    return {
      title: "",
      description: "",
      location: "",
      starts: localDateTime(starts),
      ends: localDateTime(ends),
      allDay: false,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    };
  }, [anchor]);
  const [draft, setDraft] = useState(initial);
  useEffect(() => {
    if (open) setDraft(initial());
  }, [initial, open]);
  const submit = () => {
    if (!draft.title.trim() || !draft.starts || !draft.ends) return;
    onCreate({
      title: draft.title.trim(),
      description: draft.description.trim(),
      location: draft.location.trim(),
      starts_at: new Date(draft.starts).toISOString(),
      ends_at: new Date(draft.ends).toISOString(),
      all_day: draft.allDay,
      timezone: draft.timezone,
    });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New event</DialogTitle>
          <DialogDescription>
            Create a native Misty calendar event. Tasks remain separate and appear here only when
            they have a deadline.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <label className="grid gap-1 text-xs font-medium">
            Title
            <Input
              autoFocus
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-xs font-medium">
              Starts
              <Input
                type="datetime-local"
                value={draft.starts}
                onChange={(event) => setDraft({ ...draft, starts: event.target.value })}
              />
            </label>
            <label className="grid gap-1 text-xs font-medium">
              Ends
              <Input
                type="datetime-local"
                value={draft.ends}
                onChange={(event) => setDraft({ ...draft, ends: event.target.value })}
              />
            </label>
          </div>
          <label className="grid gap-1 text-xs font-medium">
            Timezone
            <Input
              value={draft.timezone}
              onChange={(event) => setDraft({ ...draft, timezone: event.target.value })}
            />
          </label>
          <label className="grid gap-1 text-xs font-medium">
            Location
            <Input
              value={draft.location}
              onChange={(event) => setDraft({ ...draft, location: event.target.value })}
            />
          </label>
          <label className="grid gap-1 text-xs font-medium">
            Description
            <Input
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={
              busy ||
              !draft.title.trim() ||
              !draft.starts ||
              !draft.ends ||
              new Date(draft.ends) <= new Date(draft.starts)
            }
            onClick={submit}
          >
            {busy ? "Creating…" : "Create event"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function localDateTime(value: Date) {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}
