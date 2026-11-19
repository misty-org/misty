import { errorText } from "@/shared/lib/format";
import { useEffect, useMemo, useState } from "react";
import { SpaceRequestError } from "../api/api";
import { useSpaceResource } from "../api/spaceResource";
import { plannerApi, type SpaceCalendarEvent, type SpaceCalendarEventInput } from "../planner/api";
import { notifyPlannerChanged, subscribeToPlannerChanges } from "../planner/plannerEvents";
import { monthRange } from "./calendarDates";

/**
 * The Space's own events for the month around `anchor`, and what a person does to them. Each
 * month paints its last copy at once on a revisit or relaunch while a fresh one loads; a month
 * not read before keeps the one on screen until its answer arrives.
 */
export function useSpaceCalendar(spaceId: string, anchor: Date) {
  const [changeError, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const month = `${anchor.getFullYear()}-${anchor.getMonth()}`;
  const range = useMemo(() => {
    const [year, monthIndex] = month.split("-").map(Number);
    const { from, to } = monthRange(new Date(year, monthIndex, 1));
    return { from: from.toISOString(), to: to.toISOString() };
  }, [month]);
  const resource = useSpaceResource<SpaceCalendarEvent[]>(
    `/spaces/${encodeURIComponent(spaceId)}/calendar/events?${new URLSearchParams(range)}`,
    () => plannerApi.events(spaceId, range.from, range.to).then((result) => result.events),
  );
  const { reload } = resource;

  // The last month shown in this Space, kept while another month's first read is under way.
  const [shown, setShown] = useState<{ spaceId: string; events: SpaceCalendarEvent[] }>();
  if (resource.data && (shown?.events !== resource.data || shown.spaceId !== spaceId))
    setShown({ spaceId, events: resource.data });
  const kept = shown?.spaceId === spaceId ? shown.events : undefined;
  // A month whose read failed with nothing saved shows the failure, not another month's events
  // or an empty month.
  const loadFailed = !resource.data && Boolean(resource.error);
  const events = resource.data ?? (loadFailed ? undefined : kept);
  const error = changeError || (resource.error ? errorText(resource.error) : "");

  useEffect(
    () => subscribeToPlannerChanges(spaceId, "calendar", () => void reload()),
    [reload, spaceId],
  );

  const change = async (work: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    try {
      await work();
      setError("");
      notifyPlannerChanged(spaceId, "calendar");
      return true;
    } catch (reason) {
      setError(errorText(reason));
      // Someone else changed it first: load theirs, so the next open starts from it.
      if (reason instanceof SpaceRequestError && reason.code === "version_conflict") void reload();
      return false;
    } finally {
      setBusy(false);
    }
  };

  return {
    /** `undefined` until the Space's first month answers, with nothing saved. */
    events,
    /** The month's read failed with nothing saved, so `events` stays `undefined`. */
    loadFailed,
    reload,
    error,
    busy,
    save: (input: SpaceCalendarEventInput, editing?: SpaceCalendarEvent) =>
      change(() =>
        editing
          ? plannerApi.updateEvent(spaceId, editing.id, { ...input, version: editing.version })
          : plannerApi.createEvent(spaceId, input),
      ),
    remove: (event: SpaceCalendarEvent) => change(() => plannerApi.deleteEvent(spaceId, event.id)),
  };
}
