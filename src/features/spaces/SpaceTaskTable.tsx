import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SpaceMember, SpaceTask, SpaceTaskPriority, SpaceTaskStatus } from "@/spaces/types";
import {
  TaskEmptyState,
  TaskInlineSelect,
  taskPriorityOptions,
  taskStatusOptions,
  toLocalInput,
} from "./SpaceTaskPrimitives";

type TaskPatch = Partial<
  Pick<
    SpaceTask,
    "title" | "notes" | "status" | "priority" | "assignee_user_id" | "due_at" | "due_timezone"
  >
>;

export function SpaceTaskList({
  tasks,
  members,
  busy,
  canManage,
  onOpen,
  onUpdate,
}: {
  tasks: SpaceTask[];
  members: SpaceMember[];
  busy: string;
  canManage: boolean;
  onOpen: (task: SpaceTask) => void;
  onUpdate: (task: SpaceTask, patch: TaskPatch) => void;
}) {
  if (!tasks.length) return <TaskEmptyState />;

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <Table className="min-w-[840px]" aria-label="Tasks">
        <TableHeader className="bg-muted/50">
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-24">Key</TableHead>
            <TableHead className="min-w-64">Task</TableHead>
            <TableHead className="w-40">Status</TableHead>
            <TableHead className="w-32">Priority</TableHead>
            <TableHead className="w-44">Assignee</TableHead>
            <TableHead className="w-48">Due</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((task) => {
            const taskBusy = busy === task.id;
            return (
              <TableRow key={task.id}>
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
                    value={task.assignee_user_id ?? ""}
                    onChange={(value) => onUpdate(task, { assignee_user_id: value })}
                    options={[
                      ["", "Unassigned"],
                      ...members.map((member) => [member.user_id, member.name] as [string, string]),
                    ]}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    aria-label={`Due date for ${task.title}`}
                    className="h-8 border-transparent bg-transparent px-2 text-xs shadow-none hover:bg-muted"
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
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
