import { confirmAction } from "@/shared/lib/confirmAction";
import { Button, ErrorNotification, Input } from "@/shared/ui";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSpacesStore } from "../list/useSpacesStore";
import { useSpaceAgentMembers } from "../members/agents/useSpaceAgentMembers";
import type { SpaceTask, SpaceTaskStatus } from "./api";
import { SpaceTaskBoard } from "./SpaceTaskBoard";
import { assigneeValue, SpaceTaskDialog, type TaskAssignee } from "./SpaceTaskDialog";
import { taskKey } from "./taskOrdering";
import { useSpaceTasks } from "./useSpaceTasks";

/** Everyone a task in this Space can go to: its members, then the agents they brought. */
export function useTaskAssignees(spaceId: string): TaskAssignee[] {
  const members = useSpacesStore((state) => state.membersBySpace[spaceId]);
  const loadMembers = useSpacesStore((state) => state.loadMembers);
  const { agents } = useSpaceAgentMembers(spaceId);
  useEffect(() => {
    void loadMembers(spaceId).catch(() => undefined);
  }, [loadMembers, spaceId]);
  return useMemo(
    () => [
      ...(members ?? []).map((member) => ({
        value: `user:${member.user_id}`,
        label: member.name || member.email,
      })),
      ...(agents ?? []).map((agent) => ({
        value: `agent:${agent.agent_id}`,
        label: `${agent.agent_name} (${agent.owner_name}’s agent)`,
      })),
    ],
    [agents, members],
  );
}

/** The Space's planner: its tasks on a board that people and their agents work from. */
export function SpacePlanner({ spaceId }: { spaceId: string }) {
  const planner = useSpaceTasks(spaceId);
  const assignees = useTaskAssignees(spaceId);
  const [query, setQuery] = useState("");
  // `null` is a new task; `undefined` is no dialog.
  const [editing, setEditing] = useState<SpaceTask | null>();
  const [newStatus, setNewStatus] = useState<SpaceTaskStatus>("todo");

  const names = useMemo(
    () => new Map(assignees.map((assignee) => [assignee.value, assignee.label])),
    [assignees],
  );
  const shown = useMemo(() => {
    const words = query.trim().toLowerCase();
    if (!words || !planner.tasks) return planner.tasks;
    return planner.tasks.filter((task) =>
      `${taskKey(task)} ${task.title} ${task.notes}`.toLowerCase().includes(words),
    );
  }, [planner.tasks, query]);

  const remove = async (task: SpaceTask) => {
    if (!(await confirmAction(`Delete “${task.title}”? This can’t be undone.`))) return;
    if (await planner.archive(task)) setEditing(undefined);
  };

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-charcoal-bg">
      <header className="flex min-h-11 items-center gap-3 border-b border-charcoal-border px-4 py-1.5">
        <h1 className="m-0 text-sm font-semibold text-cream">Planner</h1>
        <Input
          type="search"
          className="ml-auto h-8 w-52 text-xs"
          aria-label="Search tasks"
          placeholder="Search tasks"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Button
          type="button"
          size="sm"
          onClick={() => {
            setNewStatus("todo");
            setEditing(null);
          }}
        >
          <Plus aria-hidden="true" />
          New task
        </Button>
      </header>

      <SpaceTaskBoard
        spaceId={spaceId}
        tasks={shown}
        busy={planner.busy}
        assigneeName={(task) => names.get(assigneeValue(task)) ?? ""}
        onOpen={setEditing}
        onMove={(task, status, before) => void planner.move(task, status, before)}
        onCreate={(title, status) => planner.create({ title, status })}
      />

      {editing !== undefined ? (
        <SpaceTaskDialog
          key={editing?.id ?? "new"}
          task={editing}
          initialStatus={newStatus}
          assignees={assignees}
          busy={Boolean(planner.busy)}
          onClose={() => setEditing(undefined)}
          onSave={async (input) =>
            Boolean(await (editing ? planner.update(editing, input) : planner.create(input)))
          }
          onDelete={editing ? () => void remove(editing) : undefined}
        />
      ) : null}
      <ErrorNotification message={planner.error} />
    </div>
  );
}
