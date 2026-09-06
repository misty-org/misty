import type { PlannerTaskServices } from "./taskServices";
import type { SpaceTask } from "@/api/spaces/dto/interfaces/types";
import type { TaskViewMode } from "@/api/spaces/dto/types/SpacePlanner";
import { errorText } from "@/shared/lib/format";
import { useCallback, useEffect, useRef, useState } from "react";
import { mergeTasks } from "./taskOrdering";
import type { TaskFilterParams } from "./useTaskFilterParams";

const TASK_PAGE_SIZE = 200;

/**
 * Space tasks. A generation counter drops responses from superseded loads,
 * since filter changes can overlap in flight.
 */
export function useSpaceTasksData(options: {
  api: PlannerTaskServices;
  subscribeChanges(listener: () => void): () => void;
  spaceId: string;
  view: TaskViewMode;
  filters: TaskFilterParams;
}) {
  const { spaceId, filters, api, subscribeChanges } = options;
  const [tasks, setTasks] = useState<SpaceTask[]>([]);
  const [statusTotals, setStatusTotals] = useState<Record<string, number>>({});
  const [nextCursor, setNextCursor] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const loadGenerationRef = useRef(0);
  const nextCursorRef = useRef("");

  const { status, priority, query, sort, dueRange, effectiveAssignee } = filters;

  const load = useCallback(
    async (append = false) => {
      const generation = ++loadGenerationRef.current;
      setLoading(true);
      try {
        const taskResult = await api.tasks(spaceId, {
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
        if (generation !== loadGenerationRef.current) return;
        setTasks((current) => (append ? mergeTasks(current, taskResult.tasks) : taskResult.tasks));
        nextCursorRef.current = taskResult.next_cursor ?? "";
        setNextCursor(nextCursorRef.current);
        setStatusTotals(taskResult.status_totals ?? {});
        setError("");
        setLoading(false);
      } catch (reason) {
        if (generation !== loadGenerationRef.current) return;
        setError(errorText(reason));
      } finally {
        if (generation === loadGenerationRef.current) setLoading(false);
      }
    },
    [api, dueRange?.from, dueRange?.to, effectiveAssignee, priority, query, sort, spaceId, status],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    return subscribeChanges(() => void load(false));
  }, [load, subscribeChanges]);

  return {
    tasks,
    setTasks,
    statusTotals,
    nextCursor,
    loading,
    error,
    setError,
    load,
  };
}

export type SpaceTasksData = ReturnType<typeof useSpaceTasksData>;
