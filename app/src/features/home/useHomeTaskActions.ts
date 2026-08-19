import { spacesApi } from "@/api/spaces/api";
import { useCallback, useState } from "react";

/**
 * Completing and adding a task without leaving Home.
 *
 * The agenda entry carries only a `task_id`, while `updateTask` needs the whole
 * task for its optimistic-concurrency `version` — so completing reads the task
 * back first. That is one extra request per click, which is why it is only done
 * on demand rather than prefetched for every row.
 */
export function useHomeTaskActions(onChanged: () => void) {
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const mark = (id: string, active: boolean) =>
    setPending((current) => {
      const next = new Set(current);
      if (active) next.add(id);
      else next.delete(id);
      return next;
    });

  const completeTask = useCallback(
    async (spaceId: string, taskId: string) => {
      mark(taskId, true);
      setError(null);
      try {
        const page = await spacesApi.tasks(spaceId, { limit: 200 });
        const task = page.tasks.find((candidate) => candidate.id === taskId);
        if (!task) throw new Error("That task no longer exists.");
        await spacesApi.updateTask(spaceId, task, { status: "done" });
        onChanged();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not complete that task.");
      } finally {
        mark(taskId, false);
      }
    },
    [onChanged],
  );

  const addTask = useCallback(
    async (spaceId: string, title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      mark("new", true);
      setError(null);
      try {
        await spacesApi.createTask(spaceId, {
          title: trimmed,
          notes: "",
          status: "todo",
          priority: "medium",
          due_at: endOfToday(),
          due_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        onChanged();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not add that task.");
      } finally {
        mark("new", false);
      }
    },
    [onChanged],
  );

  return { addTask, completeTask, error, pending, clearError: () => setError(null) };
}

function endOfToday(): string {
  const due = new Date();
  due.setHours(23, 59, 0, 0);
  return due.toISOString();
}
