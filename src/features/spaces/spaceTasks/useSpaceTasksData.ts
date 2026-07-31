import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorText } from "@/lib/format";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import type { TaskViewMode } from "@/models/types/features/spaces/SpacePlanner";
import type {
  SpaceCalendarEvent,
  SpaceCalendarSource,
  SpaceIntegration,
  SpaceTask,
} from "@/models/interfaces/features/spaces/types";
import { calendarRange, startOfMonth } from "./taskFiltering";
import { mergeTasks } from "./taskOrdering";
import type { TaskFilterParams } from "./useTaskFilterParams";

const TASK_PAGE_SIZE = 200;

/**
 * Tasks, calendar events and sync sources for the current filters.
 *
 * Tasks are awaited first and rendered immediately; calendar data is optional
 * and settled separately, so a Google outage degrades to a notice instead of
 * blocking the board. A generation counter drops responses from superseded
 * loads, since filter changes can overlap in flight.
 */
export function useSpaceTasksData(options: {
  spaceId: string;
  view: TaskViewMode;
  filters: TaskFilterParams;
}) {
  const { spaceId, view, filters } = options;
  const [tasks, setTasks] = useState<SpaceTask[]>([]);
  const [events, setEvents] = useState<SpaceCalendarEvent[]>([]);
  const [sources, setSources] = useState<SpaceCalendarSource[]>([]);
  const [integrations, setIntegrations] = useState<SpaceIntegration[]>([]);
  const [statusTotals, setStatusTotals] = useState<Record<string, number>>({});
  const [nextCursor, setNextCursor] = useState("");
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [calendarNotice, setCalendarNotice] = useState("");
  const [connectionsUnavailable, setConnectionsUnavailable] = useState(false);
  const loadGenerationRef = useRef(0);

  const range = useMemo(() => calendarRange(month), [month]);
  const { status, priority, query, sort, dueRange, effectiveAssignee } = filters;

  const load = useCallback(
    async (append = false) => {
      const generation = ++loadGenerationRef.current;
      setLoading(true);
      try {
        const taskRequest = spacesApi.tasks(spaceId, {
          status: status === "all" ? undefined : status,
          assigneeUserId: effectiveAssignee || undefined,
          priority: priority === "all" ? undefined : priority,
          search: query.trim() || undefined,
          dueFrom: dueRange?.from,
          dueTo: dueRange?.to,
          sort,
          cursor: append ? nextCursor : undefined,
          limit: TASK_PAGE_SIZE,
        });
        const optionalRequest = Promise.allSettled([
          spacesApi.calendarSources(spaceId),
          spacesApi.integrations(spaceId),
          view === "calendar"
            ? spacesApi.calendarEvents(spaceId, range.from.toISOString(), range.to.toISOString())
            : Promise.resolve({ events: [] as SpaceCalendarEvent[] }),
        ]);

        const taskResult = await taskRequest;
        if (generation !== loadGenerationRef.current) return;
        setTasks((current) => (append ? mergeTasks(current, taskResult.tasks) : taskResult.tasks));
        setNextCursor(taskResult.next_cursor ?? "");
        setStatusTotals(taskResult.status_totals ?? {});
        setError("");
        setLoading(false);

        const [sourceResult, integrationResult, eventResult] = await optionalRequest;
        if (generation !== loadGenerationRef.current) return;
        setSources(sourceResult.status === "fulfilled" ? sourceResult.value.sources : []);
        setIntegrations(
          integrationResult.status === "fulfilled"
            ? integrationResult.value.integrations.filter((item) => item.provider === "google")
            : [],
        );
        setEvents(eventResult.status === "fulfilled" ? eventResult.value.events : []);
        setConnectionsUnavailable(integrationResult.status === "rejected");
        const unavailable = [
          sourceResult.status === "rejected" ? "calendar sync status" : "",
          integrationResult.status === "rejected" ? "Google Calendar connections" : "",
          eventResult.status === "rejected" ? "published calendar events" : "",
        ].filter(Boolean);
        setCalendarNotice(
          unavailable.length
            ? `Tasks are available, but ${unavailable.join(" and ")} could not be checked.`
            : "",
        );
      } catch (reason) {
        if (generation === loadGenerationRef.current) setError(errorText(reason));
      } finally {
        if (generation === loadGenerationRef.current) setLoading(false);
      }
    },
    // nextCursor is read for paging but must not retrigger the effect below.
    [
      dueRange?.from,
      dueRange?.to,
      effectiveAssignee,
      nextCursor,
      priority,
      query,
      range.from,
      range.to,
      sort,
      spaceId,
      status,
      view,
    ],
  );

  useEffect(() => {
    void load(false);
  }, [
    dueRange?.from,
    dueRange?.to,
    effectiveAssignee,
    priority,
    query,
    range.from,
    range.to,
    sort,
    spaceId,
    status,
    view,
  ]);

  useEffect(() => {
    const reload = (event: Event) => {
      if ((event as CustomEvent<{ space_id?: string }>).detail?.space_id === spaceId)
        void load(false);
    };
    window.addEventListener("misty:space-coordination-event", reload);
    return () => window.removeEventListener("misty:space-coordination-event", reload);
  }, [load, spaceId]);

  return {
    tasks,
    setTasks,
    events,
    sources,
    integrations,
    statusTotals,
    nextCursor,
    month,
    setMonth,
    loading,
    error,
    setError,
    calendarNotice,
    connectionsUnavailable,
    load,
  };
}

export type SpaceTasksData = ReturnType<typeof useSpaceTasksData>;
