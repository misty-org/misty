import { errorText } from "@/shared/lib/format";
import { useCallback, useEffect, useRef, useState } from "react";
import { plannerApi, type SpaceCalendarEvent, type SpaceCalendarEventInput } from "../planner/api";
import { notifyPlannerChanged, subscribeToPlannerChanges } from "../planner/plannerEvents";
import { monthRange } from "./calendarDates";

/** The Space's own events for the month around `anchor`, and what a person does to them. */
export function useSpaceCalendar(spaceId: string, anchor: Date) {
  const [events, setEvents] = useState<SpaceCalendarEvent[]>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const month = `${anchor.getFullYear()}-${anchor.getMonth()}`;

  const load = useCallback(async () => {
    const current = ++generation.current;
    const [year, monthIndex] = month.split("-").map(Number);
    const { from, to } = monthRange(new Date(year, monthIndex, 1));
    try {
      const result = await plannerApi.events(spaceId, from.toISOString(), to.toISOString());
      if (current !== generation.current) return;
      setEvents(result.events);
      setError("");
    } catch (reason) {
      if (current !== generation.current) return;
      setEvents((known) => known ?? []);
      setError(errorText(reason));
    }
  }, [month, spaceId]);

  useEffect(() => {
    setEvents(undefined);
    void load();
    return subscribeToPlannerChanges(spaceId, "calendar", () => void load());
  }, [load, spaceId]);

  const change = async (work: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    try {
      await work();
      setError("");
      notifyPlannerChanged(spaceId, "calendar");
      return true;
    } catch (reason) {
      setError(errorText(reason));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return {
    /** `undefined` until the month's first load answers. */
    events,
    error,
    busy,
    save: (input: SpaceCalendarEventInput, editing?: SpaceCalendarEvent) =>
      change(() =>
        editing
          ? plannerApi.updateEvent(spaceId, editing.id, input)
          : plannerApi.createEvent(spaceId, input),
      ),
    remove: (event: SpaceCalendarEvent) => change(() => plannerApi.deleteEvent(spaceId, event.id)),
  };
}
