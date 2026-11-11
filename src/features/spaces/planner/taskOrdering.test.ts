import { describe, expect, it } from "vitest";
import type { SpaceTask, SpaceTaskStatus } from "./api";
import { columnTasks, dropBefore, mergeTasks, optimisticMove } from "./taskOrdering";

const task = (id: string, status: SpaceTaskStatus, rank: number): SpaceTask => ({
  id,
  space_id: "space",
  task_number: 1,
  title: id,
  notes: "",
  status,
  priority: "medium",
  rank,
  created_by_user_id: "user",
  version: 1,
  created_at: "",
  updated_at: "",
});

const board = [task("a", "todo", 1024), task("b", "todo", 2048), task("c", "done", 1024)];
const ids = (tasks: SpaceTask[], status: SpaceTaskStatus) =>
  columnTasks(tasks, status).map((item) => item.id);

describe("task ordering", () => {
  it("moves a task before another one in a different column", () => {
    const moved = optimisticMove(board, "c", "todo", "b");
    expect(ids(moved, "todo")).toEqual(["a", "c", "b"]);
    expect(ids(moved, "done")).toEqual([]);
  });

  it("moves a task to the end of a column when nothing follows it", () => {
    expect(ids(optimisticMove(board, "a", "todo"), "todo")).toEqual(["b", "a"]);
    expect(ids(optimisticMove(board, "a", "in_progress"), "in_progress")).toEqual(["a"]);
  });

  it("turns a drop on a card's upper or lower half into the task it goes before", () => {
    const column = columnTasks(board, "todo");
    expect(dropBefore(column, "c", "a", false)).toBe("a");
    expect(dropBefore(column, "c", "a", true)).toBe("b");
    expect(dropBefore(column, "c", "b", true)).toBeUndefined();
    expect(dropBefore(column, "c", "", true)).toBeUndefined();
    // Dropping a card just below itself leaves it where it is.
    expect(dropBefore(column, "a", "b", false)).toBe("b");
  });

  it("replaces a task with its saved copy", () => {
    const merged = mergeTasks(board, [{ ...board[0], title: "renamed" }, task("d", "todo", 4096)]);
    expect(merged).toHaveLength(4);
    expect(merged.find((item) => item.id === "a")?.title).toBe("renamed");
  });
});
