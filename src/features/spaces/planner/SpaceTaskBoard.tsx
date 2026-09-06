import { agentTaskDisplayState } from "@/features/agents/agentWorkState";
import { useDropZone, usePointerDrag, type PointerDragPayload } from "@/features/dnd";
import type {
  SpaceAgentMembership,
  SpaceMember,
  SpaceTask,
} from "@/api/spaces/dto/interfaces/types";
import type { SpaceTaskStatus } from "@/api/spaces/dto/types/types";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, cn } from "@/shared/ui";
import { useSurfacePresentation } from "@/shared/mobile";
import {
  CheckSquare,
  GripVertical,
  LoaderCircle,
  Maximize2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
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

const TASK_DRAG_KIND = "space-task";

/** Interactive controls inside a card own their own gestures and must not start a drag. */
const NON_DRAGGABLE_SELECTOR = "button, input, select, textarea, [role='combobox']";

const acceptsTask = (payload: PointerDragPayload) => payload.kind === TASK_DRAG_KIND;

export function SpaceTaskBoard({
  tasks,
  members,
  agents,
  totals,
  busy,
  canManage,
  onOpen,
  onMove,
  onDelete,
  onCreate,
  onOpenFullCreate,
}: {
  tasks: SpaceTask[];
  members: SpaceMember[];
  agents: SpaceAgentMembership[];
  totals: Record<string, number>;
  busy: string;
  canManage: boolean;
  onOpen: (task: SpaceTask) => void;
  onMove: (task: SpaceTask, status: SpaceTaskStatus, beforeTaskId?: string) => void;
  onDelete: (task: SpaceTask) => void;
  onCreate: (title: string, status: SpaceTaskStatus) => void;
  onOpenFullCreate?: (status: SpaceTaskStatus, initialTitle?: string) => void;
}) {
  const mobile = useSurfacePresentation() !== "desktop";
  const [creating, setCreating] = useState<SpaceTaskStatus>();
  const [title, setTitle] = useState("");

  const moveById = (taskId: string, status: SpaceTaskStatus, beforeTaskId?: string) => {
    const task = tasks.find((item) => item.id === taskId);
    if (task) onMove(task, status, beforeTaskId);
  };

  return (
    <div
      className={cn(
        "flex h-full min-h-0 gap-0 overflow-x-auto overflow-y-hidden",
        mobile && "snap-x snap-mandatory scroll-px-3 gap-3 px-3",
      )}
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
          agents={agents}
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
          }}
          onOpenFullCreate={() => {
            const initialTitle = title;
            setCreating(undefined);
            setTitle("");
            onOpenFullCreate?.(column.id, initialTitle);
          }}
          onOpen={onOpen}
          onMove={onMove}
          onDelete={onDelete}
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
  agents,
  total,
  busy,
  canManage,
  creating,
  title,
  onTitle,
  onStartCreate,
  onCancelCreate,
  onSubmitCreate,
  onOpenFullCreate,
  onOpen,
  onMove,
  onDelete,
  onMoveById,
}: {
  column: { id: SpaceTaskStatus; label: string };
  tasks: SpaceTask[];
  members: SpaceMember[];
  agents: SpaceAgentMembership[];
  total?: number;
  busy: string;
  canManage: boolean;
  creating: boolean;
  title: string;
  onTitle: (value: string) => void;
  onStartCreate: () => void;
  onCancelCreate: () => void;
  onSubmitCreate: (event: FormEvent) => void;
  onOpenFullCreate: () => void;
  onOpen: (task: SpaceTask) => void;
  onMove: (task: SpaceTask, status: SpaceTaskStatus) => void;
  onDelete: (task: SpaceTask) => void;
  onMoveById: (taskId: string, status: SpaceTaskStatus, beforeTaskId?: string) => void;
}) {
  const mobile = useSurfacePresentation() !== "desktop";
  const dropZone = useDropZone({
    id: `task-column:${column.id}`,
    accepts: acceptsTask,
    onDrop: (payload) => onMoveById(payload.id, column.id),
  });

  const handleInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancelCreate();
    }
  };

  return (
    <section
      ref={dropZone.ref}
      className={cn(
        "flex h-full min-h-0 min-w-[264px] flex-1 basis-0 flex-col",
        "border-r border-charcoal-border/55 px-3 py-2 transition-colors last:border-r-0",
        mobile &&
          "w-[calc(100vw-48px)] max-w-[420px] flex-none snap-center rounded-xl border border-charcoal-border bg-charcoal-card/35",
        dropZone.active ? "bg-charcoal-hover shadow-none" : "bg-transparent",
      )}
    >
      <header className="flex min-h-11 items-center gap-2 px-2">
        <span className={`size-2 rounded-full ${statusDot(column.id)}`} />
        <h2 className="m-0 text-xs font-semibold text-cream">{column.label}</h2>
        <span className="text-[11px] tabular-nums text-cream-muted">{total ?? tasks.length}</span>
        {canManage ? (
          <Button
            className="ml-auto size-7 text-cream-muted hover:bg-charcoal-card hover:text-cream"
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
        {/* Inline Quick Creation Card */}
        {creating ? (
          <Card className="gap-0 border-charcoal-border/80 bg-charcoal-card py-0 shadow-md ring-1 ring-charcoal-border/50">
            <form onSubmit={onSubmitCreate}>
              <CardContent className="space-y-2.5 p-3">
                <Input
                  autoFocus
                  maxLength={240}
                  placeholder="Task title"
                  value={title}
                  onChange={(event) => onTitle(event.target.value)}
                  onKeyDown={handleInputKeyDown}
                  className="h-auto border-0 bg-transparent p-0 text-xs font-medium text-cream shadow-none placeholder:text-cream-faint/40 focus-visible:ring-0"
                />
                <div className="flex items-center justify-between gap-1 border-t border-charcoal-border/40 pt-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    type="button"
                    title="Expand into full task editor"
                    onClick={onOpenFullCreate}
                    className="size-6 text-cream-muted hover:bg-charcoal-hover hover:text-cream"
                  >
                    <Maximize2 className="size-3" />
                  </Button>
                  <div className="ml-auto flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      type="button"
                      onClick={onCancelCreate}
                      className="h-6 px-2 text-[11px] text-cream-muted hover:text-cream"
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      disabled={!title.trim() || busy === `create:${column.id}`}
                      type="submit"
                      className="h-6 px-2.5 text-[11px]"
                    >
                      {busy === `create:${column.id}` ? (
                        <LoaderCircle className="size-3 animate-spin" />
                      ) : (
                        "Add"
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </form>
          </Card>
        ) : null}

        {tasks.map((task) => (
          <TaskCard
            task={task}
            members={members}
            agents={agents}
            busy={busy === task.id}
            canManage={canManage}
            onOpen={onOpen}
            onMove={onMove}
            onDelete={onDelete}
            onDropBefore={(payload) => onMoveById(payload.id, column.id, task.id)}
            key={task.id}
          />
        ))}

        {!tasks.length && !creating ? (
          <Button
            className={cn(
              "min-h-24 flex-col gap-1.5 rounded-lg border border-dashed border-charcoal-border/50 bg-transparent",
              "text-xs text-cream-muted/70 shadow-none hover:border-charcoal-border hover:bg-charcoal-card/40 hover:text-cream",
            )}
            variant="ghost"
            type="button"
            disabled={!canManage}
            onClick={onStartCreate}
          >
            <span className="grid size-6 place-items-center text-cream-muted">
              <Plus className="size-3.5" />
            </span>
            <span>Drop or create</span>
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function TaskCard({
  task,
  members,
  agents,
  busy,
  canManage,
  onOpen,
  onMove,
  onDelete,
  onDropBefore,
}: {
  task: SpaceTask;
  members: SpaceMember[];
  agents: SpaceAgentMembership[];
  busy: boolean;
  canManage: boolean;
  onOpen: (task: SpaceTask) => void;
  onMove: (task: SpaceTask, status: SpaceTaskStatus) => void;
  onDelete: (task: SpaceTask) => void;
  onDropBefore: (payload: PointerDragPayload) => void;
}) {
  const assignee = members.find((member) => member.user_id === task.assignee_user_id);
  const agent = agents.find((item) => item.agent_id === task.assignee_agent_id);
  const notes = task.notes.trim();
  const { startDrag, state } = usePointerDrag();
  const dragging = state.payload?.kind === TASK_DRAG_KIND && state.payload.id === task.id;
  const draggedRef = useRef(false);
  const dropZone = useDropZone({
    id: `task-card:${task.id}`,
    accepts: (payload) => acceptsTask(payload) && payload.id !== task.id,
    onDrop: onDropBefore,
  });

  const checklistStats = useMemo(() => {
    if (!notes) return null;
    const matches = [...notes.matchAll(/- \[(x|X| )\]/g)];
    if (!matches.length) return null;
    const completed = matches.filter((m) => m[1].toLowerCase() === "x").length;
    return { completed, total: matches.length };
  }, [notes]);

  useEffect(() => {
    if (dragging) draggedRef.current = true;
  }, [dragging]);

  const beginDrag = (event: PointerEvent<HTMLElement>) => {
    if (!canManage) return;
    if ((event.target as HTMLElement).closest(NON_DRAGGABLE_SELECTOR)) return;
    draggedRef.current = false;
    startDrag(event, { kind: TASK_DRAG_KIND, id: task.id }, <TaskDragPreview task={task} />);
  };

  return (
    <Card
      ref={dropZone.ref}
      data-misty-window-drag-block={canManage ? "true" : undefined}
      data-pointer-drag-source={canManage ? "true" : undefined}
      className={cn(
        "group min-h-36 gap-0 rounded-xl border border-charcoal-border/70 bg-charcoal-card/80 py-0 shadow-sm transition-all",
        "hover:border-charcoal-border hover:bg-charcoal-card hover:shadow-md",
        canManage ? "cursor-grab" : "cursor-default",
        dragging ? "opacity-40" : "",
        dropZone.active ? "ring-2 ring-charcoal-active" : "",
      )}
      onPointerDown={beginDrag}
    >
      <CardHeader className="min-h-0 flex-1 p-3 pb-2">
        <div className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-1.5 rounded-md text-left">
          <GripVertical className="mt-0.5 size-3.5 shrink-0 text-cream-muted opacity-0 transition-opacity group-hover:opacity-100" />
          <div className="min-w-0">
            <CardTitle className="line-clamp-2 text-sm font-semibold leading-5 text-cream">
              {task.title}
            </CardTitle>
            {notes ? (
              <p className="mb-0 mt-1 line-clamp-1 text-[11px] leading-4 text-cream-muted">
                {notes.replace(/[-*#_`[\]]/g, " ").trim()}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-0.5">
            {busy ? <LoaderCircle className="size-3.5 animate-spin text-cream-muted" /> : null}
            <div className="invisible flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
              <Button
                size="icon"
                variant="ghost"
                type="button"
                title="Edit task"
                aria-label={`Edit ${task.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpen(task);
                }}
                className="size-6 rounded-md text-cream-muted hover:bg-charcoal-hover hover:text-cream"
              >
                <Pencil className="size-3" />
              </Button>
              {canManage ? (
                <Button
                  size="icon"
                  variant="ghost"
                  type="button"
                  title="Delete task"
                  aria-label={`Delete ${task.title}`}
                  disabled={busy}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(task);
                  }}
                  className="size-6 rounded-md text-cream-muted hover:bg-charcoal-hover hover:text-notification-red"
                >
                  <Trash2 className="size-3" />
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="mt-auto shrink-0 p-3 pt-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold text-cream-muted/80">{task.task_key}</span>
          <TaskPriorityBadge priority={task.priority} />
          {checklistStats ? (
            <span
              className={cn(
                "flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium tracking-tight",
                checklistStats.completed === checklistStats.total
                  ? "bg-status-green/20 text-status-green"
                  : "bg-charcoal-workspace text-cream-muted",
              )}
              title={`${checklistStats.completed} of ${checklistStats.total} checklist items completed`}
            >
              <CheckSquare className="size-3 shrink-0" />
              <span>
                {checklistStats.completed}/{checklistStats.total}
              </span>
            </span>
          ) : null}
          {task.due_at ? (
            <span className={`text-[10px] font-medium ${dueTone(task)}`}>
              {shortDue(task.due_at)}
            </span>
          ) : null}
          {agent ? <AgentTaskState taskId={task.id} agent={agent} /> : null}
          {assignee || agent ? (
            <span className="ml-auto">
              <TaskMemberAvatar member={assignee} agent={agent} />
            </span>
          ) : null}
        </div>
        {canManage ? (
          <TaskInlineSelect
            className="mt-2"
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

function AgentTaskState({ taskId, agent }: { taskId: string; agent: SpaceAgentMembership }) {
  const state = agentTaskDisplayState(taskId, agent);
  const attention = state === "needs_approval" || state === "failed";
  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
        attention
          ? "bg-charcoal-active text-cream-bright"
          : state === "working"
            ? "bg-status-green text-sage-fg"
            : "bg-charcoal-card text-cream-muted"
      }`}
    >
      {state}
    </span>
  );
}

function TaskDragPreview({ task }: { task: SpaceTask }) {
  return (
    <div className="w-56 rounded-lg border border-charcoal-border bg-charcoal-card p-2.5 opacity-90 shadow-xl">
      <div className="line-clamp-2 text-xs font-semibold text-cream">{task.title}</div>
      <div className="mt-1 text-[10px] text-cream-muted">{task.task_key}</div>
    </div>
  );
}
