import { errorText } from "@/shared/lib/format";
import { useCallback, useEffect, useRef, useState } from "react";
import { plannerApi, type SpaceTask, type SpaceTaskInput, type SpaceTaskStatus } from "./api";
import { notifyPlannerChanged, subscribeToPlannerChanges } from "./plannerEvents";
import { mergeTasks, optimisticMove } from "./taskOrdering";

/**
 * A Space's tasks and what a person does to them. A move shows at once and is put back if the
 * server refuses it; a generation counter drops the answer of a load that a newer one replaced.
 */
export function useSpaceTasks(spaceId: string) {
  const [tasks, setTasks] = useState<SpaceTask[]>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const generation = useRef(0);

  const load = useCallback(async () => {
    const current = ++generation.current;
    try {
      const result = await plannerApi.tasks(spaceId);
      if (current !== generation.current) return;
      setTasks(result.tasks);
      setError("");
    } catch (reason) {
      if (current !== generation.current) return;
      setTasks((known) => known ?? []);
      setError(errorText(reason));
    }
  }, [spaceId]);

  useEffect(() => {
    setTasks(undefined);
    void load();
    return subscribeToPlannerChanges(spaceId, "task", () => void load());
  }, [load, spaceId]);

  /** Runs one change; `key` marks what is busy while it runs. */
  const change = async <T>(key: string, work: () => Promise<T>): Promise<T | undefined> => {
    setBusy(key);
    try {
      const result = await work();
      setError("");
      notifyPlannerChanged(spaceId, "task");
      return result;
    } catch (reason) {
      setError(errorText(reason));
      return undefined;
    } finally {
      setBusy("");
    }
  };

  return {
    /** `undefined` until the first load answers. */
    tasks,
    error,
    busy,
    reload: load,
    create: (input: SpaceTaskInput & { title: string }) =>
      change(`create:${input.status ?? "todo"}`, async () => {
        const saved = await plannerApi.createTask(spaceId, input);
        setTasks((current) => mergeTasks(current ?? [], [saved]));
        return saved;
      }),
    update: (task: SpaceTask, patch: SpaceTaskInput) =>
      change(task.id, async () => {
        const saved = await plannerApi.updateTask(spaceId, task.id, patch);
        setTasks((current) => mergeTasks(current ?? [], [saved]));
        return saved;
      }),
    move: async (task: SpaceTask, status: SpaceTaskStatus, beforeTaskId?: string) => {
      const previous = tasks;
      setTasks((current) => optimisticMove(current ?? [], task.id, status, beforeTaskId));
      const moved = await change(task.id, async () => {
        const result = await plannerApi.moveTask(spaceId, task.id, status, beforeTaskId);
        setTasks((current) => mergeTasks(current ?? [], result.reordered));
        return result.task;
      });
      if (!moved) setTasks(previous);
    },
    archive: (task: SpaceTask) =>
      change(task.id, async () => {
        await plannerApi.archiveTask(spaceId, task.id);
        setTasks((current) => current?.filter((item) => item.id !== task.id));
        return true;
      }),
  };
}

export type SpaceTasks = ReturnType<typeof useSpaceTasks>;
