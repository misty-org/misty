import {
  connectedCalendarEvents,
  type ConnectedCalendarEvent,
} from "@/features/agents/connectedAppsPublic";
import { errorText } from "@/shared/lib/format";
import { useCallback, useEffect, useRef, useState } from "react";
import { monthRange } from "./calendarDates";

/**
 * The person's connected Google Calendar for the month around `anchor`. It is read on this computer
 * and never sent to the Space: other members don't see it. Until it answers, and when nothing is
 * connected, the list is empty, so the Space's own calendar never waits on it.
 */
export function useConnectedCalendar(anchor: Date) {
  const [events, setEvents] = useState<ConnectedCalendarEvent[]>([]);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const month = `${anchor.getFullYear()}-${anchor.getMonth()}`;

  const reload = useCallback(() => {
    const current = ++generation.current;
    const [year, monthIndex] = month.split("-").map(Number);
    const { from, to } = monthRange(new Date(year, monthIndex, 1));
    connectedCalendarEvents(from.toISOString(), to.toISOString())
      .then((result) => {
        if (current !== generation.current) return;
        setEvents(result);
        setError("");
      })
      .catch((reason: unknown) => {
        if (current !== generation.current) return;
        setEvents([]);
        setError(errorText(reason));
      });
  }, [month]);

  useEffect(() => {
    setEvents([]);
    reload();
  }, [reload]);

  return { events, error, reload };
}
