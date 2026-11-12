import { usePointerReorder } from "@/shared/hooks/usePointerReorder";
import { Button, cn, IconButton, Input, OverflowFadeText, Pressable, Skeleton } from "@/shared/ui";
import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { SpaceTask, SpaceTaskStatus } from "./api";
import { boardColumns, columnTasks, dropBefore, taskKey } from "./taskOrdering";
import { dueLabel, isOverdue, priorityLabel } from "./taskText";

type BoardProps = {
  spaceId: string;
  /** `undefined` while the first load is out. */
  tasks: SpaceTask[] | undefined;
  busy: string;
  assigneeName(task: SpaceTask): string;
  onOpen(task: SpaceTask): void;
  onMove(task: SpaceTask, status: SpaceTaskStatus, beforeTaskId?: string): void;
  onCreate(title: string, status: SpaceTaskStatus): Promise<unknown>;
};

/** The Space's kanban board: one column per status, cards dragged between and within them. */
export function SpaceTaskBoard(props: BoardProps) {
  return (
    <div className="flex h-full min-h-0 overflow-x-auto overflow-y-hidden" aria-label="Task board">
      {boardColumns.map((column) => (
        <BoardColumn key={column.id} column={column} {...props} />
      ))}
    </div>
  );
}

function BoardColumn(props: BoardProps & { column: { id: SpaceTaskStatus; label: string } }) {
  const { column, tasks } = props;
  const cards = tasks ? columnTasks(tasks, column.id) : [];
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const find = (id: string) => tasks?.find((task) => task.id === id);
  // Every column listens on one scope, so a card lifted in one can land in another.
  const reorder = usePointerReorder({
    scope: `space-tasks:${props.spaceId}`,
    axis: "y",
    getDrag: (id) => {
      const task = find(id);
      return task ? { id, label: task.title } : null;
    },
    onDrop: (drag, targetId, after) => {
      const task = find(drag.id);
      if (!task) return;
      const before = dropBefore(cards, task.id, targetId, after);
      const index = cards.findIndex((card) => card.id === task.id);
      // Dropped where it already is.
      if (task.status === column.id && cards[index + 1]?.id === before) return;
      props.onMove(task, column.id, before);
    },
    onKeyboardMove: (id, direction) => {
      const task = find(id);
      const index = cards.findIndex((card) => card.id === id);
      const swap = cards[index + direction];
      if (!task || !swap) return;
      props.onMove(task, column.id, direction < 0 ? swap.id : cards[index + 2]?.id);
    },
  });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const name = title.trim();
    if (!name) return;
    setTitle("");
    await props.onCreate(name, column.id);
  };
  return (
    <section
      className={cn(
        "flex h-full min-h-0 min-w-64 flex-1 basis-0 flex-col px-3 py-2",
        "border-r border-charcoal-border/55 last:border-r-0",
      )}
      aria-label={column.label}
    >
      <header className="flex min-h-10 items-center gap-2 px-1">
        <h2 className="m-0 text-xs font-semibold text-cream">{column.label}</h2>
        {tasks ? (
          <span className="text-2xs tabular-nums text-cream-muted">{cards.length}</span>
        ) : null}
        <IconButton
          label={`New task in ${column.label}`}
          className="ml-auto"
          onClick={() => setCreating(true)}
        >
          <Plus className="size-3.5" aria-hidden="true" />
        </IconButton>
      </header>

      <div
        {...reorder}
        className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto overscroll-contain pb-6"
      >
        {creating ? (
          <form
            onSubmit={(event) => void submit(event)}
            className="grid gap-2 rounded-lg border border-charcoal-border bg-charcoal-card p-2.5"
          >
            <Input
              autoFocus
              maxLength={240}
              aria-label="Task title"
              placeholder="Task title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setCreating(false);
              }}
            />
            <div className="flex justify-end gap-1.5">
              <Button type="button" variant="quiet" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!title.trim() || props.busy === `create:${column.id}`}
              >
                Add
              </Button>
            </div>
          </form>
        ) : null}

        {tasks ? (
          cards.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              assignee={props.assigneeName(task)}
              onOpen={() => props.onOpen(task)}
            />
          ))
        ) : (
          <>
            <Skeleton className="h-20 rounded-lg" />
            <Skeleton className="h-20 rounded-lg" />
          </>
        )}
      </div>
    </section>
  );
}

function TaskCard(props: { task: SpaceTask; assignee: string; onOpen(): void }) {
  const { task } = props;
  const notes = task.notes.replace(/[-*#_`[\]]/g, " ").trim();
  return (
    <Pressable
      type="button"
      data-reorder-item={task.id}
      data-reorder-handle
      data-misty-window-drag-block="true"
      aria-label={`${taskKey(task)} ${task.title}`}
      className={cn(
        "grid w-full gap-2 rounded-lg border border-charcoal-border/70 bg-charcoal-card p-3 text-left",
        "hover:border-charcoal-border hover:bg-charcoal-hover",
      )}
      onClick={props.onOpen}
    >
      <span className="line-clamp-3 text-sm font-medium leading-5 text-cream">{task.title}</span>
      {notes ? (
        <span className="line-clamp-2 text-xs leading-4 text-cream-muted">{notes}</span>
      ) : null}
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-cream-muted">
        <span className="tabular-nums">{taskKey(task)}</span>
        {task.priority !== "medium" ? <span>{priorityLabel[task.priority]}</span> : null}
        {task.due_at ? (
          <span className={isOverdue(task) ? "font-semibold text-cream-bright" : undefined}>
            {dueLabel(task.due_at)}
          </span>
        ) : null}
        {props.assignee ? (
          <OverflowFadeText full className="ml-auto">
            {props.assignee}
          </OverflowFadeText>
        ) : null}
      </span>
    </Pressable>
  );
}
