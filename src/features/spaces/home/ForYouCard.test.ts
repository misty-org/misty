import { describe, expect, it } from "vitest";
import type { SpaceTask } from "../planner/api";
import { tasksDueSoon } from "./ForYouCard";

const now = Date.parse("2026-11-19T12:00:00Z");
const task = (patch: Partial<SpaceTask>): SpaceTask => ({
  id: "t", space_id: "s", task_number: 1, title: "Task", notes: "", status: "todo", priority: "medium", rank: 1,
  assignee_user_id: "me", due_at: "2026-11-21T00:00:00Z", created_by_user_id: "me", version: 1,
  created_at: "", updated_at: "", ...patch,
});

describe("tasksDueSoon", () => {
  it("keeps the person's open tasks due within a week, late ones included, soonest first", () => {
    const tasks = [
      task({ id: "later", due_at: "2026-11-30T00:00:00Z" }),
      task({ id: "soon", due_at: "2026-11-24T00:00:00Z" }),
      task({ id: "late", due_at: "2026-11-10T00:00:00Z" }),
      task({ id: "done", status: "done" }),
      task({ id: "other", assignee_user_id: "you" }),
      task({ id: "undated", due_at: undefined }),
    ];
    expect(tasksDueSoon(tasks, "me", now).map((t) => t.id)).toEqual(["late", "soon"]);
  });
});
