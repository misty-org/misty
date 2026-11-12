import type { EngineTodo } from "../../../runs/invocations/invocationTypes";
import { StatusRow, StatusTable, type StatusState } from "../../../progress/StatusTable";
import { WorkGroup } from "../../../progress/WorkGroup";

function status(todo: EngineTodo): { verb: string; row: StatusState } {
  switch (todo.status) {
    case "complete":
      return { verb: "Done", row: "done" };
    case "active":
      return { verb: "Working", row: "running" };
    case "blocked":
      return { verb: "Blocked", row: "waiting" };
    case "dropped":
      return { verb: "Dropped", row: "skipped" };
    default:
      return { verb: "Next", row: "next" };
  }
}

/** The engine's own todo list (Claude's TodoWrite, Codex's plan, an ACP plan), as one table. */
export function EngineTodos({ todos, live }: { todos: EngineTodo[]; live: boolean }) {
  if (!todos.length) return null;
  const done = todos.filter((todo) => todo.status === "complete").length;
  const working = live && todos.some((todo) => todo.status === "active");
  return (
    <WorkGroup summary={`${done} of ${todos.length} tasks done`} running={working} openAtStart>
      <StatusTable label="Tasks">
        {todos.map((todo, index) => {
          const { verb, row } = status(todo);
          return (
            <StatusRow key={todo.id ?? `${index}-${todo.content}`} state={row} verb={verb}>
              {todo.content}
            </StatusRow>
          );
        })}
      </StatusTable>
    </WorkGroup>
  );
}
