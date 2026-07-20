import { Flag, ListTodo } from "lucide-react";
import { EmptyState, ErrorState } from "@/components/ui/state-view";
import type { SpaceMember, SpaceTask, SpaceTaskPriority, SpaceTaskStatus } from "@/spaces/types";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type TaskDraft = {
  title: string;
  notes: string;
  status: SpaceTaskStatus;
  priority: SpaceTaskPriority;
  assignee_user_id: string;
  due_at: string;
  due_timezone: string;
};

export const taskStatusOptions: Array<[SpaceTaskStatus, string]> = [
  ["todo", "To do"],
  ["in_progress", "In progress"],
  ["done", "Done"],
  ["canceled", "Canceled"],
];

export const taskPriorityOptions: Array<[SpaceTaskPriority, string]> = [
  ["high", "High"],
  ["medium", "Medium"],
  ["low", "Low"],
];

export function TaskInlineSelect({
  value,
  options,
  disabled,
  onChange,
  className,
  label,
}: {
  value: string;
  options: Array<[string, string]>;
  disabled: boolean;
  onChange: (value: string) => void;
  className?: string;
  label: string;
}) {
  const selectedValue = value || "none";
  return (
    <Select
      disabled={disabled}
      value={selectedValue}
      onValueChange={(next) => onChange(next === "none" ? "" : next)}
    >
      <SelectTrigger
        aria-label={label}
        className={`h-8 min-w-0 border-transparent bg-transparent text-xs shadow-none hover:bg-muted ${className ?? ""}`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([id, optionLabel]) => (
          <SelectItem value={id || "none"} key={id || "none"}>
            {optionLabel}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function TaskMemberAvatar({
  member,
  size = "sm",
}: {
  member?: SpaceMember;
  size?: "sm" | "md";
}) {
  return (
    <Avatar className={size === "md" ? "size-9" : "size-6"} title={member?.name ?? "Unassigned"}>
      <AvatarFallback className={size === "md" ? "text-xs" : "text-[9px]"}>
        {member ? memberInitials(member.name) : "—"}
      </AvatarFallback>
    </Avatar>
  );
}

export function TaskPriorityBadge({ priority }: { priority: SpaceTaskPriority }) {
  return (
    <Badge
      variant={priority === "high" ? "destructive" : priority === "low" ? "secondary" : "outline"}
      className="gap-1 px-1.5 py-0 text-[10px] font-medium capitalize"
    >
      <Flag className="size-3" />
      {priority}
    </Badge>
  );
}

export function TaskStatusBadge({ status }: { status: SpaceTaskStatus }) {
  return (
    <Badge variant="secondary" className="gap-1.5 font-medium">
      <span className={`size-1.5 rounded-full ${statusDot(status)}`} />
      {taskStatusOptions.find(([id]) => id === status)?.[1] ?? status}
    </Badge>
  );
}

export function TaskEmptyState({
  title = "No tasks yet",
  description = "Tasks matching this view will appear here.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <EmptyState
      className="min-h-56 max-w-none rounded-lg bg-muted/30"
      compact
      icon={<ListTodo />}
      title={title}
      description={description}
    />
  );
}

export function TaskErrorState({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <ErrorState
      className="mb-3 max-w-none rounded-lg border border-destructive/30 bg-destructive/10 py-4"
      compact
      title="Tasks could not be loaded"
      description={message}
      action={
        <Button size="sm" variant="outline" type="button" onClick={onDismiss}>
          Dismiss
        </Button>
      }
    />
  );
}

export function dueTone(task: SpaceTask) {
  return task.due_at && new Date(task.due_at) < new Date() && task.status !== "done"
    ? "text-destructive"
    : "text-muted-foreground";
}

export function shortDue(value: string) {
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function memberName(members: SpaceMember[], id?: string) {
  return id
    ? (members.find((member) => member.user_id === id)?.name ?? "Former member")
    : "Unassigned";
}

export function toLocalInput(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function memberInitials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

export function statusDot(status: SpaceTaskStatus) {
  if (status === "done") return "bg-emerald-500";
  if (status === "in_progress") return "bg-sky-500";
  if (status === "canceled") return "bg-muted-foreground";
  return "bg-amber-500";
}
