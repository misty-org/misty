import { useCallback, useEffect, useRef, useState } from "react";
import { errorText } from "@/lib/format";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import type { TaskViewMode } from "@/models/types/features/spaces/SpacePlanner";
import type {
  SpaceCalendarSource,
  SpaceIntegration,
  SpaceTask,
} from "@/models/interfaces/features/spaces/types";
import { mergeTasks } from "./taskOrdering";
import type { TaskFilterParams } from "./useTaskFilterParams";
import { isSpaceReferenceOnly } from "@/stores/spaces/spaceConnectivity";
import { cacheSpaceTasks, readSpaceReferenceCache } from "@/stores/spaces/spaceReferenceCache";

const TASK_PAGE_SIZE = 200;

/**
 * Tasks and their optional calendar publishing connections.
 *
 * Tasks are awaited first and rendered immediately; connection data is optional
 * and settled separately, so a Google outage degrades to a notice instead of
 * blocking the board. A generation counter drops responses from superseded
 * loads, since filter changes can overlap in flight.
 */
export function useSpaceTasksData(options: {
  spaceId: string;
  view: TaskViewMode;
  filters: TaskFilterParams;
}) {
  const { spaceId, filters } = options;
  const [tasks, setTasks] = useState<SpaceTask[]>([]);
  const [sources, setSources] = useState<SpaceCalendarSource[]>([]);
  const [integrations, setIntegrations] = useState<SpaceIntegration[]>([]);
  const [statusTotals, setStatusTotals] = useState<Record<string, number>>({});
  const [nextCursor, setNextCursor] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [calendarNotice, setCalendarNotice] = useState("");
  const [connectionsUnavailable, setConnectionsUnavailable] = useState(false);
  const loadGenerationRef = useRef(0);

  const { status, priority, query, sort, dueRange, effectiveAssignee } = filters;

  const load = useCallback(
    async (append = false) => {
      const generation = ++loadGenerationRef.current;
      setLoading(true);
      try {
        const taskRequest = spacesApi.tasks(spaceId, {
          status: status === "all" ? undefined : status,
          assigneeUserId: effectiveAssignee
            ? effectiveAssignee.startsWith("person:")
              ? effectiveAssignee.slice(7)
              : effectiveAssignee.startsWith("agent:")
                ? undefined
                : effectiveAssignee
            : undefined,
          assigneeAgentId: effectiveAssignee.startsWith("agent:")
            ? effectiveAssignee.slice(6)
            : undefined,
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
        ]);

        const taskResult = await taskRequest;
        if (generation !== loadGenerationRef.current) return;
        setTasks((current) => (append ? mergeTasks(current, taskResult.tasks) : taskResult.tasks));
        setNextCursor(taskResult.next_cursor ?? "");
        setStatusTotals(taskResult.status_totals ?? {});
        cacheSpaceTasks(spaceId, taskResult);
        setError("");
        setLoading(false);

        const [sourceResult, integrationResult] = await optionalRequest;
        if (generation !== loadGenerationRef.current) return;
        setSources(sourceResult.status === "fulfilled" ? sourceResult.value.sources : []);
        setIntegrations(
          integrationResult.status === "fulfilled"
            ? integrationResult.value.integrations.filter((item) => item.provider === "google")
            : [],
        );
        setConnectionsUnavailable(integrationResult.status === "rejected");
        const unavailable = [
          sourceResult.status === "rejected" ? "calendar sync status" : "",
          integrationResult.status === "rejected" ? "Google Calendar connections" : "",
        ].filter(Boolean);
        setCalendarNotice(
          unavailable.length
            ? `Tasks are available, but ${unavailable.join(" and ")} could not be checked.`
            : "",
        );
      } catch (reason) {
        if (generation !== loadGenerationRef.current) return;
        const cached = isSpaceReferenceOnly()
          ? (await readSpaceReferenceCache())?.tasksBySpace?.[spaceId]
          : undefined;
        if (generation !== loadGenerationRef.current) return;
        if (cached) {
          setTasks(filterCachedTasks(cached.tasks, filters));
          setStatusTotals(cached.status_totals ?? {});
          setNextCursor("");
          setSources([]);
          setIntegrations([]);
          setConnectionsUnavailable(true);
          setCalendarNotice("Saved task data is available. Reconnect to refresh calendar details.");
          setError("");
        } else {
          setError(errorText(reason));
        }
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
      sort,
      spaceId,
      status,
    ],
  );

  useEffect(() => {
    void load(false);
  }, [dueRange?.from, dueRange?.to, effectiveAssignee, priority, query, sort, spaceId, status]);

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
    sources,
    integrations,
    statusTotals,
    nextCursor,
    loading,
    error,
    setError,
    calendarNotice,
    connectionsUnavailable,
    load,
  };
}

function filterCachedTasks(tasks: SpaceTask[], filters: TaskFilterParams): SpaceTask[] {
  const query = filters.query.trim().toLowerCase();
  return tasks
    .filter((task) => filters.status === "all" || task.status === filters.status)
    .filter((task) => filters.priority === "all" || task.priority === filters.priority)
    .filter((task) => !query || `${task.title} ${task.notes}`.toLowerCase().includes(query))
    .filter((task) => {
      if (filters.assignee === "unassigned")
        return !task.assignee_user_id && !task.assignee_agent_id;
      if (!filters.effectiveAssignee) return true;
      if (filters.effectiveAssignee.startsWith("person:"))
        return task.assignee_user_id === filters.effectiveAssignee.slice(7);
      if (filters.effectiveAssignee.startsWith("agent:"))
        return task.assignee_agent_id === filters.effectiveAssignee.slice(6);
      return true;
    })
    .filter((task) => {
      if (filters.due === "no_due") return !task.due_at;
      if (!filters.dueRange) return true;
      if (!task.due_at) return false;
      const due = new Date(task.due_at).getTime();
      const from = filters.dueRange.from ? new Date(filters.dueRange.from).getTime() : -Infinity;
      const to = filters.dueRange.to ? new Date(filters.dueRange.to).getTime() : Infinity;
      return due >= from && due <= to;
    });
}

export type SpaceTasksData = ReturnType<typeof useSpaceTasksData>;
