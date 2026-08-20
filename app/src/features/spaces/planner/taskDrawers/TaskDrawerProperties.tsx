import type { SpaceAgentMembership, SpaceMember } from "@/api/spaces/dto/interfaces/types";
import type { TaskDraft } from "@/api/spaces/dto/types/SpaceTaskPrimitives";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  cn,
} from "@/shared/ui";
import { Bot, ChevronDown, Flag, User } from "lucide-react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import {
  statusDot,
  TaskMemberAvatar,
  taskPriorityOptions,
  taskStatusOptions,
} from "../SpaceTaskPrimitives";
import { TaskDatePicker } from "../components/TaskDatePicker";

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
  const currentStatusLabel = taskStatusOptions.find(([s]) => s === draft.status)?.[1] ?? "To do";

  const currentPriorityLabel =
    taskPriorityOptions.find(([p]) => p === draft.priority)?.[1] ?? "Medium";

  const assignedMember = draft.assignee_user_id
    ? members.find((m) => m.user_id === draft.assignee_user_id)
    : undefined;

  const assignedAgent = draft.assignee_agent_id
    ? agents.find((a) => a.agent_id === draft.assignee_agent_id)
    : undefined;

  const assigneeDisplay = assignedAgent?.name ?? assignedMember?.name ?? "Unassigned";

  return (
    <aside
      className={cn(
        "flex flex-col gap-4 border-l border-charcoal-border/60 bg-charcoal-card/40 p-5",
        "max-sm:border-l-0 max-sm:border-t max-sm:border-charcoal-border/60",
      )}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wider text-cream-faint/70">
        Properties
      </div>

      <div className="grid gap-3.5">
        {/* Status */}
        <PropertyRow label="Status">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                type="button"
                disabled={!canManage}
                className={cn(
                  "flex h-8 w-full items-center justify-between gap-2 rounded-lg border-charcoal-border/70",
                  "bg-charcoal-workspace/60 px-2.5 text-xs text-cream shadow-none transition-all",
                  "hover:border-charcoal-border hover:bg-charcoal-card",
                  "disabled:pointer-events-none disabled:opacity-50",
                )}
              >
                <div className="flex items-center gap-2 truncate">
                  <span className={`size-2 shrink-0 rounded-full ${statusDot(draft.status)}`} />
                  <span className="font-medium">{currentStatusLabel}</span>
                </div>
                <ChevronDown className="size-3.5 shrink-0 text-cream-muted" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              {taskStatusOptions.map(([statusKey, label]) => (
                <DropdownMenuItem
                  key={statusKey}
                  onClick={() => setDraft({ ...draft, status: statusKey })}
                  className={cn(
                    "flex items-center gap-2 text-xs",
                    draft.status === statusKey && "font-semibold text-cream-bright",
                  )}
                >
                  <span className={`size-2 shrink-0 rounded-full ${statusDot(statusKey)}`} />
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </PropertyRow>

        {/* Priority */}
        <PropertyRow label="Priority">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                type="button"
                disabled={!canManage}
                className={cn(
                  "flex h-8 w-full items-center justify-between gap-2 rounded-lg border-charcoal-border/70",
                  "bg-charcoal-workspace/60 px-2.5 text-xs text-cream shadow-none transition-all",
                  "hover:border-charcoal-border hover:bg-charcoal-card",
                  "disabled:pointer-events-none disabled:opacity-50",
                )}
              >
                <div className="flex items-center gap-2 truncate">
                  <Flag
                    className={cn(
                      "size-3.5 shrink-0",
                      draft.priority === "high"
                        ? "text-avatar-red"
                        : draft.priority === "low"
                          ? "text-avatar-blue"
                          : "text-avatar-yellow",
                    )}
                  />
                  <span className="font-medium">{currentPriorityLabel}</span>
                </div>
                <ChevronDown className="size-3.5 shrink-0 text-cream-muted" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              {taskPriorityOptions.map(([priorityKey, label]) => (
                <DropdownMenuItem
                  key={priorityKey}
                  onClick={() => setDraft({ ...draft, priority: priorityKey })}
                  className={cn(
                    "flex items-center gap-2 text-xs",
                    draft.priority === priorityKey && "font-semibold text-cream-bright",
                  )}
                >
                  <Flag
                    className={cn(
                      "size-3.5 shrink-0",
                      priorityKey === "high"
                        ? "text-avatar-red"
                        : priorityKey === "low"
                          ? "text-avatar-blue"
                          : "text-avatar-yellow",
                    )}
                  />
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </PropertyRow>

        {/* Assignee */}
        <PropertyRow label="Assignee">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                type="button"
                disabled={!canManage}
                className={cn(
                  "flex h-8 w-full items-center justify-between gap-2 rounded-lg border-charcoal-border/70",
                  "bg-charcoal-workspace/60 px-2.5 text-xs text-cream shadow-none transition-all",
                  "hover:border-charcoal-border hover:bg-charcoal-card",
                  "disabled:pointer-events-none disabled:opacity-50",
                )}
              >
                <div className="flex items-center gap-2 truncate">
                  {assignedAgent ? (
                    <Bot className="size-3.5 shrink-0 text-sage-fg" />
                  ) : assignedMember ? (
                    <TaskMemberAvatar member={assignedMember} size="sm" />
                  ) : (
                    <User className="size-3.5 shrink-0 text-cream-muted" />
                  )}
                  <span className="truncate font-medium">{assigneeDisplay}</span>
                </div>
                <ChevronDown className="size-3.5 shrink-0 text-cream-muted" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56 max-h-60 overflow-y-auto">
              <DropdownMenuItem
                onClick={() => setDraft({ ...draft, assignee_user_id: "", assignee_agent_id: "" })}
                className="flex items-center gap-2 text-xs text-cream-muted"
              >
                <User className="size-3.5 opacity-60" />
                Unassigned
              </DropdownMenuItem>
              {members.length > 0 ? (
                <>
                  <div className="px-2 py-1 text-[10px] font-semibold text-cream-faint/60 uppercase tracking-wider">
                    Members
                  </div>
                  {members.map((member) => (
                    <DropdownMenuItem
                      key={member.user_id}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          assignee_user_id: member.user_id,
                          assignee_agent_id: "",
                        })
                      }
                      className={cn(
                        "flex items-center gap-2 text-xs",
                        draft.assignee_user_id === member.user_id &&
                          "font-semibold text-cream-bright bg-charcoal-hover",
                      )}
                    >
                      <TaskMemberAvatar member={member} size="sm" />
                      <span className="truncate">{member.name}</span>
                    </DropdownMenuItem>
                  ))}
                </>
              ) : null}
              {agents.filter((a) => a.enabled && a.can_control).length > 0 ? (
                <>
                  <div className="px-2 py-1 text-[10px] font-semibold text-cream-faint/60 uppercase tracking-wider">
                    Agents
                  </div>
                  {agents
                    .filter((a) => a.enabled && a.can_control)
                    .map((agent) => (
                      <DropdownMenuItem
                        key={agent.agent_id}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            assignee_agent_id: agent.agent_id,
                            assignee_user_id: "",
                          })
                        }
                        className={cn(
                          "flex items-center gap-2 text-xs",
                          draft.assignee_agent_id === agent.agent_id &&
                            "font-semibold text-cream-bright bg-charcoal-hover",
                        )}
                      >
                        <Bot className="size-3.5 text-sage-fg" />
                        <span className="truncate">{agent.name}</span>
                      </DropdownMenuItem>
                    ))}
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </PropertyRow>

        {/* Due Date */}
        <PropertyRow label="Due date">
          <TaskDatePicker
            value={draft.due_at}
            onChange={(val) => setDraft({ ...draft, due_at: val })}
            disabled={!canManage}
          />
        </PropertyRow>
      </div>
    </aside>
  );
}

function PropertyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <label className="text-[11px] font-medium text-cream-muted">{label}</label>
      {children}
    </div>
  );
}
