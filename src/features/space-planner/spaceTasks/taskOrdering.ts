import type { SpaceTask } from "@/services/spaces/dto/interfaces/types";
import type { SpaceTaskStatus } from "@/services/spaces/dto/types/types";

const RANK_STEP = 1024;

/** Upserts by id and re-sorts, so a saved task lands wherever its rank says. */
export function mergeTasks(current: SpaceTask[], incoming: SpaceTask[]) {
  const next = new Map(current.map((item) => [item.id, item]));
  incoming.forEach((item) => next.set(item.id, item));
  return [...next.values()].sort(
    (a, b) => a.status.localeCompare(b.status) || a.rank - b.rank || a.id.localeCompare(b.id),
  );
}

/**
 * Re-ranks a column locally so a board drag lands before the server replies.
 *
 * Ranks are spaced by 1024 rather than 1 so the backend has room to insert
 * between two cards without rewriting the whole column.
 */
export function optimisticMove(
  tasks: SpaceTask[],
  id: string,
  status: SpaceTaskStatus,
  beforeId?: string,
) {
  const moving = tasks.find((item) => item.id === id);
  if (!moving) return tasks;
  const rest = tasks.filter((item) => item.id !== id);
  const column = rest.filter((item) => item.status === status).sort((a, b) => a.rank - b.rank);
  const index = beforeId
    ? Math.max(
        0,
        column.findIndex((item) => item.id === beforeId),
      )
    : column.length;
  column.splice(index, 0, { ...moving, status });
  const ranked = new Map(
    column.map((item, itemIndex) => [item.id, { ...item, rank: (itemIndex + 1) * RANK_STEP }]),
  );
  return rest.map((item) => ranked.get(item.id) ?? item).concat(ranked.get(id) ?? moving);
}
