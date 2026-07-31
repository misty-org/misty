import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from "react";
import { GripVertical, LoaderCircle, Plus } from "lucide-react";
import { Button } from "@/ui";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui";
import { Input } from "@/ui";
import type { SpaceTaskStatus } from "@/models/types/features/spaces/types";
import type { SpaceMember, SpaceTask } from "@/models/interfaces/features/spaces/types";
import {
  dueTone,
  shortDue,
  statusDot,
  TaskInlineSelect,
  TaskMemberAvatar,
  TaskPriorityBadge,
  taskStatusOptions,
} from "./SpaceTaskPrimitives";
import { TaskSyncBadge } from "@/features/spaces/components/TaskSyncBadge";
import {
  useDropZone,
  usePointerDrag,
  type PointerDragPayload,
} from "@/features/dnd/PointerDragContext";

const boardStatuses: Array<{ id: SpaceTaskStatus; label: string }> = [
  { id: "todo", label: "To do" },
  { id: "in_progress", label: "In progress" },
  { id: "done", label: "Done" },
];

const TASK_DRAG_KIND = "space-task";

/** Interactive controls inside a card own their own gestures and must not start a drag. */
const NON_DRAGGABLE_SELECTOR = "button, input, select, textarea, [role='combobox']";

const acceptsTask = (payload: PointerDragPayload) => payload.kind === TASK_DRAG_KIND;

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

  const moveById = (taskId: string, status: SpaceTaskStatus, beforeTaskId?: string) => {
    const task = tasks.find((item) => item.id === taskId);
    if (task) onMove(task, status, beforeTaskId);
  };

  return (
    <div
      className="flex h-full min-h-0 gap-0 overflow-x-auto overflow-y-hidden"
      aria-label="Task board"
    >
      {boardStatuses.map((column) => (
        <BoardColumn
          key={column.id}
          column={column}
          tasks={tasks
            .filter((task) => task.status === column.id)
            .sort((left, right) => left.rank - right.rank)}
          members={members}
          total={totals[column.id]}
          busy={busy}
          canManage={canManage}
          creating={creating === column.id}
          title={title}
          onTitle={setTitle}
          onStartCreate={() => {
            setCreating(column.id);
            setTitle("");
          }}
          onCancelCreate={() => setCreating(undefined)}
          onSubmitCreate={(event: FormEvent) => {
            event.preventDefault();
            if (!title.trim()) return;
            onCreate(title.trim(), column.id);
            setTitle("");
            setCreating(undefined);
          }}
          onOpen={onOpen}
          onMove={onMove}
          onMoveById={moveById}
        />
      ))}
    </div>
  );
}

function BoardColumn({
  column,
  tasks,
  members,
  total,
  busy,
  canManage,
  creating,
  title,
  onTitle,
  onStartCreate,
  onCancelCreate,
  onSubmitCreate,
  onOpen,
  onMove,
  onMoveById,
}: {
  column: { id: SpaceTaskStatus; label: string };
  tasks: SpaceTask[];
  members: SpaceMember[];
  total?: number;
  busy: string;
  canManage: boolean;
  creating: boolean;
  title: string;
  onTitle: (value: string) => void;
  onStartCreate: () => void;
  onCancelCreate: () => void;
  onSubmitCreate: (event: FormEvent) => void;
  onOpen: (task: SpaceTask) => void;
  onMove: (task: SpaceTask, status: SpaceTaskStatus) => void;
  onMoveById: (taskId: string, status: SpaceTaskStatus, beforeTaskId?: string) => void;
}) {
  const dropZone = useDropZone({
    id: `task-column:${column.id}`,
    accepts: acceptsTask,
    onDrop: (payload) => onMoveById(payload.id, column.id),
  });

  return (
    <section
      ref={dropZone.ref}
      className={`flex h-full min-h-0 min-w-[264px] flex-1 basis-0 flex-col border-r border-border/55 px-3 py-2 transition-colors last:border-r-0 ${
        dropZone.active
          ? "bg-accent/45 shadow-[inset_0_2px_0_color-mix(in_srgb,var(--primary)_45%,transparent)]"
          : "bg-transparent"
      }`}
    >
      <header className="flex min-h-11 items-center gap-2 px-2">
        <span className={`size-2 rounded-full ${statusDot(column.id)}`} />
        <h2 className="m-0 text-xs font-semibold text-foreground">{column.label}</h2>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {total ?? tasks.length}
        </span>
        {canManage ? (
          <Button
            className="ml-auto size-7"
            size="icon"
            variant="ghost"
            type="button"
            onClick={onStartCreate}
            aria-label={`Create in ${column.label}`}
          >
            <Plus className="size-3.5" />
          </Button>
        ) : null}
      </header>

      <div className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto overscroll-contain pr-0.5">
        {tasks.map((task) => (
          <TaskCard
            task={task}
            members={members}
            busy={busy === task.id}
            canManage={canManage}
            onOpen={onOpen}
            onMove={onMove}
            onDropBefore={(payload) => onMoveById(payload.id, column.id, task.id)}
            key={task.id}
          />
        ))}

        {creating ? (
          <Card className="gap-0 py-0 shadow-none ring-foreground/8">
            <form onSubmit={onSubmitCreate}>
              <CardContent className="p-3">
                <Input
                  autoFocus
                  maxLength={240}
                  placeholder="Task title"
                  value={title}
                  onChange={(event) => onTitle(event.target.value)}
                />
                <div className="mt-2 flex justify-end gap-2">
                  <Button size="sm" variant="ghost" type="button" onClick={onCancelCreate}>
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

        {!tasks.length && !creating ? (
          <Button
            className="misty-spaces-interactive min-h-28 flex-col gap-2 rounded-md border-0 bg-transparent text-xs text-muted-foreground shadow-none hover:bg-muted/35"
            variant="ghost"
            type="button"
            disabled={!canManage}
            onClick={onStartCreate}
          >
            <span className="grid size-7 place-items-center text-muted-foreground">
              <Plus className="size-3.5" />
            </span>
            Drop or create
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function TaskCard({
  task,
  members,
  busy,
  canManage,
  onOpen,
  onMove,
  onDropBefore,
}: {
  task: SpaceTask;
  members: SpaceMember[];
  busy: boolean;
  canManage: boolean;
  onOpen: (task: SpaceTask) => void;
  onMove: (task: SpaceTask, status: SpaceTaskStatus) => void;
  onDropBefore: (payload: PointerDragPayload) => void;
}) {
  const assignee = members.find((member) => member.user_id === task.assignee_user_id);
  const { startDrag, state } = usePointerDrag();
  const dragging = state.payload?.kind === TASK_DRAG_KIND && state.payload.id === task.id;
  const draggedRef = useRef(false);
  const dropZone = useDropZone({
    id: `task-card:${task.id}`,
    accepts: (payload) => acceptsTask(payload) && payload.id !== task.id,
    onDrop: onDropBefore,
  });

  useEffect(() => {
    if (dragging) draggedRef.current = true;
  }, [dragging]);

  const beginDrag = (event: PointerEvent<HTMLElement>) => {
    if (!canManage) return;
    if ((event.target as HTMLElement).closest(NON_DRAGGABLE_SELECTOR)) return;
    draggedRef.current = false;
    startDrag(event, { kind: TASK_DRAG_KIND, id: task.id }, <TaskDragPreview task={task} />);
  };

  // A drag ends with a click on the source; opening the task then would be wrong.
  const openTask = () => {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    onOpen(task);
  };

  return (
    <Card
      ref={dropZone.ref}
      data-misty-window-drag-block={canManage ? "true" : undefined}
      data-pointer-drag-source={canManage ? "true" : undefined}
      className={`misty-spaces-interactive group gap-0 py-0 shadow-sm ring-foreground/8 hover:shadow-md ${
        canManage ? "cursor-grab" : "cursor-default"
      } ${dragging ? "opacity-40" : ""} ${dropZone.active ? "ring-2 ring-primary" : ""}`}
      onPointerDown={beginDrag}
    >
      <CardHeader className="p-3 pb-2">
        <div
          className="flex w-full items-start gap-1.5 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          role="button"
          tabIndex={0}
          onClick={openTask}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            onOpen(task);
          }}
        >
          <GripVertical className="mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          <CardTitle className="line-clamp-3 flex-1 text-sm leading-5">{task.title}</CardTitle>
          {busy ? <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" /> : null}
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-medium text-muted-foreground">{task.task_key}</span>
          <TaskPriorityBadge priority={task.priority} />
          <TaskSyncBadge task={task} />
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

function TaskDragPreview({ task }: { task: SpaceTask }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2 shadow-lg">
      <p className="m-0 line-clamp-2 text-sm font-medium text-foreground">{task.title}</p>
      <span className="text-[10px] font-medium text-muted-foreground">{task.task_key}</span>
    </div>
  );
}
