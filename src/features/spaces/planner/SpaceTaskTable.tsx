import type {
  SpaceAgentMembership,
  SpaceMember,
  SpaceTask,
} from "@/api/spaces/dto/interfaces/types";
import type { SpaceTaskPriority, SpaceTaskStatus } from "@/api/spaces/dto/types/types";
import {
  Button,
  Card,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui";
import { useSurfacePresentation } from "@/shared/mobile";
import { CalendarClock, ChevronRight, LoaderCircle, Trash2 } from "lucide-react";
import {
  TaskEmptyState,
  TaskInlineSelect,
  taskPriorityOptions,
  taskStatusOptions,
  toLocalInput,
} from "./SpaceTaskPrimitives";

export function SpaceTaskList({
  tasks,
  members,
  agents,
  busy,
  canManage,
  onOpen,
  onUpdate,
  onDelete,
}: {
  tasks: SpaceTask[];
  members: SpaceMember[];
  agents: SpaceAgentMembership[];
  busy: string;
  canManage: boolean;
  onOpen: (task: SpaceTask) => void;
  onUpdate: (task: SpaceTask, patch: TaskPatch) => void;
  onDelete: (task: SpaceTask) => void;
}) {
  const mobile = useSurfacePresentation() !== "desktop";
  if (!tasks.length) return <TaskEmptyState />;

  if (mobile) {
    return (
      <div className="grid gap-2" aria-label="Tasks">
        {tasks.map((task) => {
          const taskBusy = busy === task.id;
          const assignee = task.assignee_agent_id
            ? agents.find((agent) => agent.agent_id === task.assignee_agent_id)?.name
            : members.find((member) => member.user_id === task.assignee_user_id)?.name;
          return (
            <article
              key={task.id}
              className="rounded-xl border border-charcoal-border bg-charcoal-card px-4 py-3"
            >
              <Button
                type="button"
                variant="ghost"
                className="flex h-auto min-h-11 w-full items-start justify-start gap-3 rounded-none p-0 text-left hover:bg-transparent"
                onClick={() => onOpen(task)}
              >
                <span className="mt-0.5 text-xs font-medium text-cream-muted">{task.task_key}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium leading-5 text-cream-bright">
                    {task.title}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-cream-muted">
                    <span>{task.status.replace(/_/g, " ")}</span>
                    <span>{task.priority}</span>
                    {assignee ? <span>{assignee}</span> : null}
                  </span>
                  {task.due_at ? (
                    <span className="mt-1.5 flex items-center gap-1 text-xs text-cream-muted">
                      <CalendarClock className="size-3.5" />
                      {new Date(task.due_at).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  ) : null}
                </span>
                {taskBusy ? (
                  <LoaderCircle className="mt-1 size-4 animate-spin" />
                ) : (
                  <ChevronRight className="mt-1 size-5 text-cream-muted" />
                )}
              </Button>
              {canManage ? (
                <div className="mt-2 grid grid-cols-2 gap-2 border-t border-charcoal-border pt-2">
                  <TaskInlineSelect
                    label={`Status for ${task.title}`}
                    disabled={taskBusy}
                    value={task.status}
                    onChange={(value) => onUpdate(task, { status: value as SpaceTaskStatus })}
                    options={taskStatusOptions}
                  />
                  <TaskInlineSelect
                    label={`Priority for ${task.title}`}
                    disabled={taskBusy}
                    value={task.priority}
                    onChange={(value) => onUpdate(task, { priority: value as SpaceTaskPriority })}
                    options={taskPriorityOptions}
                  />
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    );
  }

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <Table className="min-w-[840px]" aria-label="Tasks">
        <TableHeader className="bg-charcoal-card">
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-24">Key</TableHead>
            <TableHead className="min-w-64">Task</TableHead>
            <TableHead className="w-40">Status</TableHead>
            <TableHead className="w-32">Priority</TableHead>
            <TableHead className="w-44">Assignee</TableHead>
            <TableHead className="w-48">Due</TableHead>
            <TableHead className="w-12">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((task) => {
            const taskBusy = busy === task.id;
            return (
              <TableRow key={task.id} className="group/task-row">
                <TableCell>
                  <Button
                    className="h-auto p-0 text-xs font-medium"
                    variant="link"
                    type="button"
                    onClick={() => onOpen(task)}
                  >
                    {task.task_key}
                  </Button>
                </TableCell>
                <TableCell>
                  <Button
                    className="h-auto max-w-[420px] justify-start p-0 text-left text-sm font-medium hover:bg-transparent"
                    variant="ghost"
                    type="button"
                    onClick={() => onOpen(task)}
                  >
                    {taskBusy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                    <span className="truncate">{task.title}</span>
                  </Button>
                </TableCell>
                <TableCell>
                  <TaskInlineSelect
                    label={`Status for ${task.title}`}
                    disabled={!canManage || taskBusy}
                    value={task.status}
                    onChange={(value) => onUpdate(task, { status: value as SpaceTaskStatus })}
                    options={taskStatusOptions}
                  />
                </TableCell>
                <TableCell>
                  <TaskInlineSelect
                    label={`Priority for ${task.title}`}
                    disabled={!canManage || taskBusy}
                    value={task.priority}
                    onChange={(value) => onUpdate(task, { priority: value as SpaceTaskPriority })}
                    options={taskPriorityOptions}
                  />
                </TableCell>
                <TableCell>
                  <TaskInlineSelect
                    label={`Assignee for ${task.title}`}
                    disabled={!canManage || taskBusy}
                    value={
                      task.assignee_agent_id
                        ? `agent:${task.assignee_agent_id}`
                        : task.assignee_user_id
                          ? `person:${task.assignee_user_id}`
                          : ""
                    }
                    onChange={(value) =>
                      onUpdate(task, {
                        assignee_user_id: value.startsWith("person:") ? value.slice(7) : undefined,
                        assignee_agent_id: value.startsWith("agent:") ? value.slice(6) : undefined,
                      })
                    }
                    options={[
                      ["", "Unassigned"],
                      ...members.map(
                        (member) => [`person:${member.user_id}`, member.name] as [string, string],
                      ),
                      ...agents
                        .filter((agent) => agent.enabled && agent.can_control)
                        .map(
                          (agent) =>
                            [`agent:${agent.agent_id}`, `${agent.name} · Agent`] as [
                              string,
                              string,
                            ],
                        ),
                    ]}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    aria-label={`Due date for ${task.title}`}
                    className="h-8 border-transparent bg-transparent px-2 text-xs shadow-none hover:bg-charcoal-card"
                    disabled={!canManage || taskBusy}
                    type="datetime-local"
                    value={task.due_at ? toLocalInput(task.due_at) : ""}
                    onChange={(event) =>
                      onUpdate(task, {
                        due_at: event.target.value
                          ? new Date(event.target.value).toISOString()
                          : undefined,
                      })
                    }
                  />
                </TableCell>
                <TableCell>
                  {canManage ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      type="button"
                      title="Delete task"
                      aria-label={`Delete ${task.title}`}
                      disabled={taskBusy}
                      onClick={() => onDelete(task)}
                      className="invisible size-7 text-cream-muted opacity-0 transition-opacity group-focus-within/task-row:visible group-focus-within/task-row:opacity-100 group-hover/task-row:visible group-hover/task-row:opacity-100 hover:bg-charcoal-card hover:text-notification-red"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

export type TaskPatch = Partial<
  Pick<
    SpaceTask,
    | "title"
    | "notes"
    | "status"
    | "priority"
    | "assignee_user_id"
    | "assignee_agent_id"
    | "due_at"
    | "due_timezone"
  >
>;
