import { useState, type DragEvent, type FormEvent } from "react";
import { GripVertical, LoaderCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { SpaceMember, SpaceTask, SpaceTaskStatus } from "@/spaces/types";
import {
  dueTone,
  shortDue,
  statusDot,
  TaskInlineSelect,
  TaskMemberAvatar,
  TaskPriorityBadge,
  taskStatusOptions,
} from "./SpaceTaskPrimitives";

const boardStatuses: Array<{ id: SpaceTaskStatus; label: string }> = [
  { id: "todo", label: "To do" },
  { id: "in_progress", label: "In progress" },
  { id: "done", label: "Done" },
];

export function SpaceTaskBoard({
  tasks,
  members,
  totals,
  busy,
  canManage,
  onOpen,
  onMove,
  onCreate,
}: {
  tasks: SpaceTask[];
  members: SpaceMember[];
  totals: Record<string, number>;
  busy: string;
  canManage: boolean;
  onOpen: (task: SpaceTask) => void;
  onMove: (task: SpaceTask, status: SpaceTaskStatus, beforeTaskId?: string) => void;
  onCreate: (title: string, status: SpaceTaskStatus) => void;
}) {
  const [creating, setCreating] = useState<SpaceTaskStatus>();
  const [title, setTitle] = useState("");
  const [dragging, setDragging] = useState("");

  const submit = (event: FormEvent, status: SpaceTaskStatus) => {
    event.preventDefault();
    if (!title.trim()) return;
    onCreate(title.trim(), status);
    setTitle("");
    setCreating(undefined);
  };

  const moveFromEvent = (event: DragEvent, status: SpaceTaskStatus, beforeTaskId?: string) => {
    event.preventDefault();
    const taskId = event.dataTransfer.getData("text/misty-task");
    const task = tasks.find((item) => item.id === taskId);
    if (task) onMove(task, status, beforeTaskId);
    setDragging("");
  };

  return (
    <div className="flex min-h-full gap-3 overflow-x-auto pb-3" aria-label="Task board">
      {boardStatuses.map((column) => {
        const columnTasks = tasks
          .filter((task) => task.status === column.id)
          .sort((left, right) => left.rank - right.rank);

        return (
          <section
            className="flex min-h-[520px] w-[min(340px,86vw)] min-w-[290px] flex-col rounded-xl bg-muted/35 p-2"
            key={column.id}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => moveFromEvent(event, column.id)}
          >
            <header className="flex min-h-10 items-center gap-2 px-2">
              <span className={`size-2 rounded-full ${statusDot(column.id)}`} />
              <h2 className="m-0 text-xs font-semibold text-foreground">{column.label}</h2>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {totals[column.id] ?? columnTasks.length}
              </span>
              {canManage ? (
                <Button
                  className="ml-auto size-7"
                  size="icon"
                  variant="ghost"
                  type="button"
                  onClick={() => {
                    setCreating(column.id);
                    setTitle("");
                  }}
                  aria-label={`Create in ${column.label}`}
                >
                  <Plus className="size-3.5" />
                </Button>
              ) : null}
            </header>

            <div className="grid content-start gap-2">
              {columnTasks.map((task) => (
                <TaskCard
                  task={task}
                  members={members}
                  busy={busy === task.id}
                  canManage={canManage}
                  dragging={dragging === task.id}
                  onOpen={onOpen}
                  onMove={onMove}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/misty-task", task.id);
                    setDragging(task.id);
                  }}
                  onDrop={(event) => moveFromEvent(event, column.id, task.id)}
                  key={task.id}
                />
              ))}

              {creating === column.id ? (
                <Card className="gap-0 py-0 shadow-none ring-foreground/8">
                  <form onSubmit={(event) => submit(event, column.id)}>
                    <CardContent className="p-3">
                      <Input
                        autoFocus
                        maxLength={240}
                        placeholder="Task title"
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                      />
                      <div className="mt-2 flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          type="button"
                          onClick={() => setCreating(undefined)}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          disabled={!title.trim() || busy === `create:${column.id}`}
                          type="submit"
                        >
                          {busy === `create:${column.id}` ? (
                            <LoaderCircle className="size-3.5 animate-spin" />
                          ) : null}
                          Add
                        </Button>
                      </div>
                    </CardContent>
                  </form>
                </Card>
              ) : null}

              {!columnTasks.length && creating !== column.id ? (
                <Button
                  className="min-h-28 bg-muted/45 text-xs text-muted-foreground shadow-none hover:bg-muted/65"
                  variant="ghost"
                  type="button"
                  disabled={!canManage}
                  onClick={() => setCreating(column.id)}
                >
                  Drop or create
                </Button>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TaskCard({
  task,
  members,
  busy,
  canManage,
  dragging,
  onOpen,
  onMove,
  onDragStart,
  onDrop,
}: {
  task: SpaceTask;
  members: SpaceMember[];
  busy: boolean;
  canManage: boolean;
  dragging: boolean;
  onOpen: (task: SpaceTask) => void;
  onMove: (task: SpaceTask, status: SpaceTaskStatus) => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}) {
  const assignee = members.find((member) => member.user_id === task.assignee_user_id);

  return (
    <Card
      className={`group cursor-default gap-0 py-0 shadow-none ring-foreground/8 transition-opacity ${dragging ? "opacity-40" : ""}`}
      draggable={canManage}
      onDragStart={onDragStart}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.stopPropagation();
        onDrop(event);
      }}
    >
      <CardHeader className="p-3 pb-2">
        <Button
          className="h-auto w-full items-start justify-start whitespace-normal p-0 text-left hover:bg-transparent"
          variant="ghost"
          onClick={() => onOpen(task)}
        >
          <GripVertical className="mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          <CardTitle className="line-clamp-3 flex-1 text-sm leading-5">{task.title}</CardTitle>
          {busy ? <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" /> : null}
        </Button>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-medium text-muted-foreground">{task.task_key}</span>
          <TaskPriorityBadge priority={task.priority} />
          {task.due_at ? (
            <span className={`text-[10px] font-medium ${dueTone(task)}`}>
              {shortDue(task.due_at)}
            </span>
          ) : null}
          <span className="ml-auto">
            <TaskMemberAvatar member={assignee} />
          </span>
        </div>
        {canManage ? (
          <TaskInlineSelect
            className="mt-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
            label={`Status for ${task.title}`}
            value={task.status}
            onChange={(value) => onMove(task, value as SpaceTaskStatus)}
            options={taskStatusOptions}
            disabled={busy}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
