import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock, MoreHorizontal } from "lucide-react";
import { useAuth } from "@/features/auth";
import {
  Button,
  CollectionItems,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Spinner,
} from "@/shared/ui";
import type { ScheduledTask } from "@/api/scheduled/api";
import { useScheduledTasksStore } from "./useScheduledTasksStore";
import { ScheduledTaskEditor } from "./ScheduledTaskEditor";
import { describeFrequency, describeSchedule, formatLocalTime } from "./scheduleFormat";

/** The Agents entry for the same account schedules used by the task workspace. */
export function ScheduledCollection({
  query,
  view,
  creating,
  onCreatingChange,
}: {
  query: string;
  view: "list" | "grid";
  creating: boolean;
  onCreatingChange: (value: boolean) => void;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { tasks, state, error, load } = useScheduledTasksStore();
  const [editing, setEditing] = useState<ScheduledTask>();
  useEffect(() => {
    useScheduledTasksStore.getState().setAccount(user?.id ?? "");
    void load();
  }, [user?.id, load]);
  const open = (task: ScheduledTask) =>
    navigate(`/agents?view=scheduled&task=${encodeURIComponent(task.id)}`);
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const items = tasks
    .filter((task) =>
      `${task.title} ${describeSchedule(task)}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
    )
    .map((task) => ({
      id: task.id,
      title: task.title,
      icon: <CalendarClock />,
      category: !task.enabled
        ? "Paused"
        : task.state === "running"
          ? "Running"
          : task.state === "failed"
            ? "Failed"
            : describeSchedule(task),
      metadata: {
        Status: !task.enabled
          ? "Paused"
          : task.state === "running"
            ? "Running"
            : task.state === "failed"
              ? "Failed"
              : "Scheduled",
        "Time zone": task.timezone,
        "Next run":
          task.enabled && task.next_run_at ? new Date(task.next_run_at).toLocaleString() : "—",
        "Last run": task.last_run_at ? new Date(task.last_run_at).toLocaleString() : "—",
        Runs: task.run_count,
      },
      sortValues: {
        "Next run": task.enabled && task.next_run_at ? Date.parse(task.next_run_at) : undefined,
        "Last run": task.last_run_at ? Date.parse(task.last_run_at) : undefined,
      },
      updatedAt: task.updated_at,
      updated: new Date(task.updated_at).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
      onOpen: () => open(task),
      actions: (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label={`More actions for ${task.title}`}>
              <MoreHorizontal />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => open(task)}>Open</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setEditing(task)}>Edit schedule</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    }));
  return (
    <>
      {error && (
        <div role="alert" className="flex items-center gap-3 text-sm">
          {error}
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      )}
      {state === "loading" && !items.length ? (
        <Spinner label="Loading scheduled tasks" />
      ) : (
        <CollectionItems
          columnSetId="scheduled"
          fields={["Status", "Time zone", "Next run", "Last run", "Runs"]}
          items={items}
          view={view}
          columns={[
            {
              key: "frequency",
              label: "Frequency",
              sortValue: (item) => describeFrequency(tasksById.get(item.id)!),
              render: (item) => describeFrequency(tasksById.get(item.id)!),
            },
            {
              key: "time",
              label: "Time",
              sortValue: (item) => {
                const [hours, minutes] = tasksById.get(item.id)!.local_time.split(":").map(Number);
                return hours * 60 + minutes;
              },
              render: (item) => {
                const task = tasksById.get(item.id)!;
                return <span title={task.timezone}>{formatLocalTime(task.local_time)}</span>;
              },
            },
            {
              key: "updated",
              label: "Last activity",
              sortValue: (item) => Date.parse(tasksById.get(item.id)!.updated_at),
              render: (item) => <span className="text-xs">{item.updated}</span>,
            },
          ]}
        />
      )}
      {(creating || editing) && (
        <ScheduledTaskEditor
          key={editing?.id ?? "new"}
          open
          task={editing}
          onOpenChange={(open) => {
            if (!open) {
              onCreatingChange(false);
              setEditing(undefined);
            }
          }}
          onSaved={(task) => {
            onCreatingChange(false);
            setEditing(undefined);
            open(task);
          }}
        />
      )}
    </>
  );
}
