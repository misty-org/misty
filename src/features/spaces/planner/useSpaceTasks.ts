import { errorText } from "@/shared/lib/format";
import { useCallback, useEffect, useState } from "react";
import { SpaceRequestError } from "../api/api";
import { useSpaceResource } from "../api/spaceResource";
import { plannerApi, type SpaceTask, type SpaceTaskInput, type SpaceTaskStatus } from "./api";
import { notifyPlannerChanged, subscribeToPlannerChanges } from "./plannerEvents";
import { mergeTasks, optimisticMove } from "./taskOrdering";

/**
 * A Space's tasks and what a person does to them. A move shows at once and is put back if the
 * server refuses it. The last list paints at once on a revisit or relaunch, from the one cached
 * copy the planner and the calendar share, and a fresh one loads behind it.
 */
export function useSpaceTasks(spaceId: string) {
  const resource = useSpaceResource<SpaceTask[]>(
    `/spaces/${encodeURIComponent(spaceId)}/tasks`,
    () => plannerApi.tasks(spaceId).then((result) => result.tasks),
  );
  const { reload: reloadTasks, set: setTasks } = resource;
  const tasks = resource.data;
  // With nothing saved and the read refused, there is no list to show: the page says it failed
  // rather than that there are no tasks.
  const loadFailed = !resource.data && Boolean(resource.error);
  const [changeError, setError] = useState("");
  const error = changeError || (resource.error ? errorText(resource.error) : "");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    await reloadTasks();
  }, [reloadTasks]);

  useEffect(() => subscribeToPlannerChanges(spaceId, "task", () => void load()), [load, spaceId]);

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
      // Someone else changed it first: load theirs, so the next open starts from it.
      if (reason instanceof SpaceRequestError && reason.code === "version_conflict") void load();
      return undefined;
    } finally {
      setBusy("");
    }
  };

  return {
    /** `undefined` until the first load answers. */
    tasks,
    /** The first read failed with nothing saved, so `tasks` stays `undefined`. */
    loadFailed,
    error,
    busy,
    reload: load,
    create: (input: SpaceTaskInput & { title: string }) =>
      change(`create:${input.status ?? "todo"}`, async () => {
        const saved = await plannerApi.createTask(spaceId, input);
        setTasks((current) => mergeTasks(current ?? [], [saved]));
        return saved;
      }),
    /** Sends only what changed, against the version `task` was read at. */
    update: (task: SpaceTask, patch: SpaceTaskInput) =>
      change(task.id, async () => {
        const saved = await plannerApi.updateTask(spaceId, task.id, {
          ...patch,
          version: task.version,
        });
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
      if (!moved && previous) setTasks(previous);
    },
    archive: (task: SpaceTask) =>
      change(task.id, async () => {
        await plannerApi.archiveTask(spaceId, task.id);
        setTasks((current) => (current ?? []).filter((item) => item.id !== task.id));
        return true;
      }),
  };
}
