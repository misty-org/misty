import { spacesApi } from "@/api/spaces/api";
import type {
  SpaceCalendarSource,
  SpaceIntegration,
  SpaceTask,
} from "@/api/spaces/dto/interfaces/types";
import type { TaskViewMode } from "@/api/spaces/dto/types/SpacePlanner";
import { errorText } from "@/shared/lib/format";
import { useCallback, useEffect, useRef, useState } from "react";
import { mergeTasks } from "./taskOrdering";
import type { TaskFilterParams } from "./useTaskFilterParams";

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
  const nextCursorRef = useRef("");

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
          cursor: append ? nextCursorRef.current : undefined,
          limit: TASK_PAGE_SIZE,
        });
        const optionalRequest = Promise.allSettled([
          spacesApi.calendarSources(spaceId),
          spacesApi.integrations(spaceId),
        ]);

        const taskResult = await taskRequest;
        if (generation !== loadGenerationRef.current) return;
        setTasks((current) => (append ? mergeTasks(current, taskResult.tasks) : taskResult.tasks));
        nextCursorRef.current = taskResult.next_cursor ?? "";
        setNextCursor(nextCursorRef.current);
        setStatusTotals(taskResult.status_totals ?? {});
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
        setError(errorText(reason));
      } finally {
        if (generation === loadGenerationRef.current) setLoading(false);
      }
    },
    [dueRange?.from, dueRange?.to, effectiveAssignee, priority, query, sort, spaceId, status],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

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

export type SpaceTasksData = ReturnType<typeof useSpaceTasksData>;
