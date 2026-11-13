import { confirmAction } from "@/shared/lib/confirmAction";
import { Button, EmptyState, SearchField, Surface, useNotice } from "@/shared/ui";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
  // A link to one task (search's results) opens it once the board has loaded.
  const [params, setParams] = useSearchParams();
  const linkedTask = params.get("task");
  useEffect(() => {
    if (!linkedTask || !planner.tasks) return;
    const task = planner.tasks.find((item) => item.id === linkedTask);
    if (task) setEditing(task);
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("task");
        return next;
      },
      { replace: true },
    );
  }, [linkedTask, planner.tasks, setParams]);

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
  useNotice(Boolean(planner.error), { message: planner.error, tone: "error" });
  // With no tasks at all, the empty state offers New task, so the bar doesn't repeat it.
  const empty = planner.tasks?.length === 0;
  const newTask = () => {
    setNewStatus("todo");
    setEditing(null);
  };

  return (
    <Surface tone="page" className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
      {/* Search and New task; the page has no title, since the sidebar and the tab name it.
          While the board is empty its empty state offers New task, so the bar holds neither. */}
      <div
        role="toolbar"
        aria-label="Planner"
        className="flex min-h-12 items-center gap-3 px-4 py-1.5"
      >
        {empty ? null : (
          <>
            <SearchField
              data-tour="planner-search"
              containerClassName="ml-auto w-56"
              aria-label="Search tasks"
              placeholder="Search tasks"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button
              type="button"
              variant="primary"
              icon={Plus}
              onClick={newTask}
              data-tour="planner-new"
            >
              New task
            </Button>
          </>
        )}
      </div>

      {empty ? (
        <span data-tour="planner-new" className="contents">
          <EmptyState
            title="No tasks yet"
            line="Tasks you and your agents add to this Space show up here."
            action={{ label: "New task", icon: Plus, onClick: newTask }}
          />
        </span>
      ) : (
        <SpaceTaskBoard
          spaceId={spaceId}
          tasks={shown}
          busy={planner.busy}
          assigneeName={(task) => names.get(assigneeValue(task)) ?? ""}
          onOpen={setEditing}
          onMove={(task, status, before) => void planner.move(task, status, before)}
          onCreate={(title, status) => planner.create({ title, status })}
        />
      )}

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
    </Surface>
  );
}
