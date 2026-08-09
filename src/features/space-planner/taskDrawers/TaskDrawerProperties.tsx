import type { SpaceAgentMembership, SpaceMember } from "@/services/spaces/dto/interfaces/types";
import type { TaskDraft } from "@/services/spaces/dto/types/SpaceTaskPrimitives";
import type { SpaceTaskPriority, SpaceTaskStatus } from "@/services/spaces/dto/types/types";
import { Input, Label } from "@/shared/ui";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { TaskInlineSelect, taskPriorityOptions, taskStatusOptions } from "../SpaceTaskPrimitives";

/** The task drawer's right-hand rail: status, priority, assignee and due date. */
export function TaskDrawerProperties({
  draft,
  setDraft,
  members,
  agents,
  canManage,
}: {
  draft: TaskDraft;
  setDraft: Dispatch<SetStateAction<TaskDraft>> | ((draft: TaskDraft) => void);
  members: SpaceMember[];
  agents: SpaceAgentMembership[];
  canManage: boolean;
}) {
  return (
    <aside className="grid content-start gap-5 border-l border-charcoal-border/60 bg-charcoal-card p-5 max-sm:border-l-0 max-sm:border-t max-sm:border-charcoal-border/60">
      <TaskProperty label="Status">
        <TaskInlineSelect
          label="Task status"
          disabled={!canManage}
          value={draft.status}
          onChange={(value) => setDraft({ ...draft, status: value as SpaceTaskStatus })}
          options={taskStatusOptions}
        />
      </TaskProperty>
      <TaskProperty label="Priority">
        <TaskInlineSelect
          label="Task priority"
          disabled={!canManage}
          value={draft.priority}
          onChange={(value) => setDraft({ ...draft, priority: value as SpaceTaskPriority })}
          options={taskPriorityOptions}
        />
      </TaskProperty>
      <TaskProperty label="Assignee">
        <TaskInlineSelect
          label="Task assignee"
          disabled={!canManage}
          value={
            draft.assignee_agent_id
              ? `agent:${draft.assignee_agent_id}`
              : draft.assignee_user_id
                ? `person:${draft.assignee_user_id}`
                : ""
          }
          onChange={(value) =>
            setDraft({
              ...draft,
              assignee_user_id: value.startsWith("person:") ? value.slice(7) : "",
              assignee_agent_id: value.startsWith("agent:") ? value.slice(6) : "",
            })
          }
          options={[
            ["", "Unassigned"],
            ...members.map((member): [string, string] => [`person:${member.user_id}`, member.name]),
            ...agents
              .filter((agent) => agent.enabled)
              .map((agent): [string, string] => [
                `agent:${agent.agent_id}`,
                `${agent.name} · Agent`,
              ]),
          ]}
        />
      </TaskProperty>
      <TaskProperty label="Due date">
        <Input
          type="datetime-local"
          value={draft.due_at}
          onChange={(event) => setDraft({ ...draft, due_at: event.target.value })}
        />
      </TaskProperty>
    </aside>
  );
}

function TaskProperty({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-cream-muted">{label}</Label>
      {children}
    </div>
  );
}
