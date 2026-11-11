import type { SpaceTask, SpaceTaskStatus } from "./api";

const RANK_STEP = 1024;

/** The board's columns, left to right. Canceled tasks have no column; the task's own page sets it. */
export const boardColumns: { id: SpaceTaskStatus; label: string }[] = [
  { id: "todo", label: "To do" },
  { id: "in_progress", label: "In progress" },
  { id: "done", label: "Done" },
];

/** A column's tasks in board order. */
export function columnTasks(tasks: SpaceTask[], status: SpaceTaskStatus): SpaceTask[] {
  return tasks
    .filter((task) => task.status === status)
    .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
}

/** Upserts by id, so a saved task replaces its older copy. */
export function mergeTasks(current: SpaceTask[], incoming: SpaceTask[]): SpaceTask[] {
  const next = new Map(current.map((task) => [task.id, task]));
  incoming.forEach((task) => next.set(task.id, task));
  return [...next.values()];
}

/** Re-ranks a column locally so a drag lands before the server replies. */
export function optimisticMove(
  tasks: SpaceTask[],
  id: string,
  status: SpaceTaskStatus,
  beforeId?: string,
): SpaceTask[] {
  const moving = tasks.find((task) => task.id === id);
  if (!moving) return tasks;
  const column = columnTasks(
    tasks.filter((task) => task.id !== id),
    status,
  );
  const at = beforeId ? column.findIndex((task) => task.id === beforeId) : -1;
  column.splice(at < 0 ? column.length : at, 0, { ...moving, status });
  const ranked = new Map(
    column.map((task, index) => [task.id, { ...task, rank: (index + 1) * RANK_STEP }]),
  );
  return tasks.map((task) => ranked.get(task.id) ?? task);
}

/**
 * Where a drop lands, as the task it goes before: a card dropped on the lower half of another goes
 * before the one after it, and a drop on an empty column or past the last card goes to the end.
 */
export function dropBefore(
  column: SpaceTask[],
  movingId: string,
  targetId: string,
  after: boolean,
): string | undefined {
  const rest = column.filter((task) => task.id !== movingId);
  const index = rest.findIndex((task) => task.id === targetId);
  if (index < 0) return undefined;
  return rest[after ? index + 1 : index]?.id;
}

/** "T-12": how people refer to a task. */
export const taskKey = (task: Pick<SpaceTask, "task_number">) => `T-${task.task_number}`;
