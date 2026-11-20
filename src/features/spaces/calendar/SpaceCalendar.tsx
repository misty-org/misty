import { confirmAction } from "@/shared/lib/confirmAction";
import { createDeviceSetting } from "@/shared/lib/deviceSetting";
import {
  Button,
  ChoiceGroup,
  ErrorState,
  IconButton,
  PageHeader,
  Surface,
  Text,
  useNotice,
} from "@misty/ui";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { SpaceCrumb } from "../components/space-row/SpaceCrumb";
import type { SpaceCalendarEvent, SpaceTask } from "../planner/api";
import { SpaceTaskDialog } from "../planner/SpaceTaskDialog";
import { useTaskAssignees } from "../planner/SpacePlanner";
import { useSpaceTasks } from "../planner/useSpaceTasks";
import {
  calendarEntries,
  dayKey,
  eventDayKey,
  monthTitle,
  moveMonth,
  type CalendarEntry,
} from "./calendarDates";
import { CalendarEventDialog } from "./CalendarEventDialog";
import { CalendarAgenda, CalendarMonth } from "./CalendarViews";
import { useSpaceCalendar } from "./useSpaceCalendar";

type View = "month" | "agenda";

/** Month or agenda, kept in `misty.db` for this device and the same in every Space. */
const useCalendarView = createDeviceSetting<{ view: View }>({
  scope: "spaces.calendar.view",
  defaults: { view: "month" },
  normalize: (stored) => ({
    view: (stored as { view?: unknown }).view === "agenda" ? "agenda" : "month",
  }),
});

/** The Space's calendar: its own events, and the Planner's tasks on the days they are due. */
export function SpaceCalendar({ spaceId }: { spaceId: string }) {
  // A link to one event (search's results) carries its start, so the right month loads first.
  const [params, setParams] = useSearchParams();
  const linkedEvent = params.get("event");
  const linkedAt = params.get("at");
  const [anchor, setAnchor] = useState(() => {
    const at = linkedAt ? new Date(linkedAt) : undefined;
    return at && !Number.isNaN(at.getTime()) ? at : new Date();
  });
  const view = useCalendarView((state) => state.value.view);
  const saveView = useCalendarView((state) => state.set);
  const setView = (next: View) => saveView({ view: next });
  const calendar = useSpaceCalendar(spaceId, anchor);
  const planner = useSpaceTasks(spaceId);
  const assignees = useTaskAssignees(spaceId);
  // An open event dialog: an event to edit, or the day a new one starts on.
  const [editing, setEditing] = useState<{ event: SpaceCalendarEvent | null; day: string }>();
  const [task, setTask] = useState<SpaceTask>();
  useEffect(() => {
    if (!linkedAt) return;
    const at = new Date(linkedAt);
    if (!Number.isNaN(at.getTime())) setAnchor(at);
  }, [linkedAt]);
  useEffect(() => {
    if (!linkedEvent || !calendar.events) return;
    const event = calendar.events.find((item) => item.id === linkedEvent);
    // The month it is in may still be loading; the link waits for it.
    if (!event) return;
    setEditing({ event, day: eventDayKey(event) });
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("event");
        next.delete("at");
        return next;
      },
      { replace: true },
    );
  }, [linkedEvent, calendar.events, setParams]);

  const entries = useMemo(
    () =>
      calendar.events && planner.tasks
        ? calendarEntries(calendar.events, planner.tasks)
        : undefined,
    [calendar.events, planner.tasks],
  );
  const open = (entry: CalendarEntry) => {
    if (entry.kind === "task") setTask(entry.task);
    else setEditing({ event: entry.event, day: entry.day });
  };
  const newEvent = (day: string) => setEditing({ event: null, day });
  const removeEvent = async (event: SpaceCalendarEvent) => {
    if (!(await confirmAction(`Delete “${event.title}”? This can’t be undone.`))) return;
    if (await calendar.remove(event)) setEditing(undefined);
  };
  const View = view === "month" ? CalendarMonth : CalendarAgenda;
  const error = calendar.error || planner.error;
  // The month or the tasks couldn't be read with nothing saved: the grid says so instead of
  // showing an empty month. The notice is for what goes wrong after.
  const loadFailed = calendar.loadFailed || planner.loadFailed;
  useNotice(Boolean(error) && !loadFailed, { message: error, tone: "error" });

  return (
    <Surface tone="page" className="grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)]">
      {/* The bar every Space page wears, with New event; the month's controls sit under it, as
          a collection page's filters do. */}
      <PageHeader
        title={<SpaceCrumb spaceId={spaceId} here="Calendar" />}
        end={
          <Button
            type="button"
            variant="primary"
            icon={Plus}
            onClick={() => newEvent(dayKey(new Date()))}
            data-tour="calendar-new"
          >
            New event
          </Button>
        }
      />
      <div
        role="toolbar"
        aria-label="Calendar"
        className="flex min-w-0 min-h-12 items-center gap-2 px-4 py-1.5"
      >
        <span data-tour="calendar-months" className="contents">
          <IconButton label="Previous month" onClick={() => setAnchor(moveMonth(anchor, -1))}>
            <ChevronLeft aria-hidden="true" />
          </IconButton>
          <IconButton label="Next month" onClick={() => setAnchor(moveMonth(anchor, 1))}>
            <ChevronRight aria-hidden="true" />
          </IconButton>
          <Text bare tone="default" className="min-w-32 text-sm" aria-live="polite">
            {monthTitle(anchor)}
          </Text>
          <Button type="button" variant="quiet" onClick={() => setAnchor(new Date())}>
            Today
          </Button>
        </span>
        <span data-tour="calendar-view" className="contents">
          <ChoiceGroup
            className="ml-auto"
            label="Calendar view"
            value={view}
            options={[
              { value: "month", label: "Month" },
              { value: "agenda", label: "Agenda" },
            ]}
            onChange={setView}
          />
        </span>
      </div>

      <div className="min-h-0 overflow-x-auto" data-tour="calendar-grid">
        {loadFailed ? (
          <ErrorState
            title="The calendar couldn’t load"
            action={{
              label: "Try again",
              variant: "secondary",
              onClick: () => {
                if (calendar.loadFailed) void calendar.reload();
                if (planner.loadFailed) void planner.reload();
              },
            }}
          />
        ) : (
          <View anchor={anchor} entries={entries} onOpen={open} onNew={newEvent} />
        )}
      </div>

      {editing ? (
        <CalendarEventDialog
          key={editing.event?.id ?? `new:${editing.day}`}
          event={editing.event}
          day={editing.day}
          busy={calendar.busy}
          onClose={() => setEditing(undefined)}
          onSave={(input) => calendar.save(input, editing.event ?? undefined)}
          onDelete={editing.event ? () => void removeEvent(editing.event!) : undefined}
        />
      ) : null}
      {task ? (
        <SpaceTaskDialog
          key={task.id}
          task={task}
          initialStatus={task.status}
          assignees={assignees}
          busy={Boolean(planner.busy)}
          onClose={() => setTask(undefined)}
          onSave={async (input) => Boolean(await planner.update(task, input))}
        />
      ) : null}
    </Surface>
  );
}
