import { TurnTasks, type TurnTaskState } from "@misty/ui";
import type { EngineTodo } from "../../../runs/invocations/invocation_types";

const taskStates: Record<NonNullable<EngineTodo["status"]>, TurnTaskState> = {
  pending: "pending",
  active: "working",
  complete: "done",
  blocked: "failed",
  dropped: "skipped",
};

export function EngineTasks({ todos, live }: { todos: EngineTodo[]; live: boolean }) {
  const unfinished = todos.some((todo) => todo.status !== "complete" && todo.status !== "dropped");
  if (!todos.length || (!live && !unfinished)) return null;
  return (
    <TurnTasks
      label="Tasks"
      tasks={todos.map((todo, index) => ({
        id: todo.id ?? `${index}:${todo.content}`,
        title: todo.content,
        state: taskStates[todo.status ?? "pending"],
      }))}
    />
  );
}
