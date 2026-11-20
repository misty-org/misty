import { MistyError } from "@misty/sdk";
import type { Task, TaskStatus } from "@misty/sdk";
import { useMe, useMembers, useTasks } from "@misty/sdk-react";
import { useMemo, useState } from "react";

const columns: { status: TaskStatus; title: string }[] = [
  { status: "todo", title: "To do" },
  { status: "in_progress", title: "In progress" },
  { status: "done", title: "Done" },
];

/** What a card offers to do with its task, by where it is now. */
const moves: Record<TaskStatus, { to: TaskStatus; label: string }[]> = {
  todo: [{ to: "in_progress", label: "Start" }],
  in_progress: [
    { to: "done", label: "Done" },
    { to: "todo", label: "Back" },
  ],
  done: [{ to: "todo", label: "Reopen" }],
  canceled: [{ to: "todo", label: "Reopen" }],
};

const dueFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

function describe(error: unknown): string {
  if (error instanceof MistyError) {
    if (error.code === "conflict") return "Someone changed that task first. The latest is shown.";
    if (error.code === "permission_denied") return "Planner isn't allowed to do that in this Space.";
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function App() {
  const me = useMe();
  const tasks = useTasks();
  const members = useMembers();
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const names = useMemo(
    () => new Map((members.value ?? []).map((member) => [member.user_id, member.name])),
    [members.value],
  );
  const byColumn = useMemo(() => {
    const open = (tasks.value ?? []).filter((task) => task.status !== "canceled");
    return columns.map((column) => ({
      ...column,
      tasks: open.filter((task) => task.status === column.status).sort((a, b) => a.rank - b.rank),
    }));
  }, [tasks.value]);

  const run = async (work: () => Promise<unknown>) => {
    setError("");
    try {
      await work();
    } catch (reason) {
      setError(describe(reason));
    }
  };

  const add = () => {
    const text = title.trim();
    if (!text) return;
    setTitle("");
    void run(() => tasks.create({ title: text, assignee_user_id: me.user_id }));
  };

  const card = (task: Task) => (
    <li key={task.id} className="card">
      <p className="card-title">{task.title}</p>
      <p className="card-meta">
        {task.assignee_user_id ? (names.get(task.assignee_user_id) ?? "Someone") : "Unassigned"}
        {task.due_at ? ` · due ${dueFormat.format(new Date(task.due_at))}` : ""}
      </p>
      <div className="card-actions">
        {moves[task.status].map((move) => (
          <button
            key={move.to}
            type="button"
            onClick={() => void run(() => tasks.update(task.id, task.version, { status: move.to }))}
          >
            {move.label}
          </button>
        ))}
        {removing === task.id ? (
          <>
            <button
              type="button"
              className="danger"
              onClick={() => {
                setRemoving(null);
                void run(() => tasks.remove(task.id));
              }}
            >
              Remove task
            </button>
            <button type="button" onClick={() => setRemoving(null)}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className="quiet" onClick={() => setRemoving(task.id)}>
            Remove
          </button>
        )}
      </div>
    </li>
  );

  return (
    <main className="planner">
      <header className="bar">
        <h1>Planner</h1>
        <form
          className="add"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <input
            aria-label="New task"
            placeholder="Add a task"
            value={title}
            maxLength={240}
            onChange={(event) => setTitle(event.target.value)}
          />
          <button type="submit" className="primary" disabled={!title.trim()}>
            Add
          </button>
        </form>
      </header>
      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}
      {tasks.error && !tasks.value ? (
        <p role="alert" className="note">
          Tasks couldn't load. {tasks.error.message}
        </p>
      ) : tasks.loading && !tasks.value ? (
        <div className="board" aria-hidden="true">
          {columns.map((column) => (
            <section key={column.status} className="column">
              <h2>{column.title}</h2>
              <div className="skeleton" />
              <div className="skeleton" />
            </section>
          ))}
        </div>
      ) : (
        <div className="board">
          {byColumn.map((column) => (
            <section key={column.status} className="column" aria-label={column.title}>
              <h2>
                {column.title} <span className="count">{column.tasks.length}</span>
              </h2>
              <ul>{column.tasks.map(card)}</ul>
              {column.tasks.length === 0 ? <p className="empty">Nothing here.</p> : null}
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
