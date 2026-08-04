import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  ExternalLink,
  MessageSquare,
  RotateCcw,
  Settings,
  Square,
  UserPlus,
} from "lucide-react";
import { Badge, Button, Progress, ScrollArea, cn } from "@/ui";
import { AgentAvatar } from "@/features/agents/AgentAvatar";
import type {
  AgentAvatar as AgentAvatarValue,
  PersonalAgent,
} from "@/models/interfaces/features/agents/personal";
import type { SpaceAgentMembership } from "@/models/interfaces/features/spaces/types";
import type {
  AgentToolboxAction,
  SpaceRun,
  SpaceRunDetail,
} from "@/models/interfaces/features/spaces/agentArchitectureTypes";

export interface AgentDockAgent {
  id: string;
  name: string;
  description: string;
  role: string;
  icon: string;
  avatar?: AgentAvatarValue;
  coordinator?: boolean;
  personal?: PersonalAgent;
  membership?: SpaceAgentMembership;
}

export function AgentWorkView({
  agent,
  runs,
  conversations,
  running,
  loading,
  details,
  actingRunId,
  actionError,
  onDecide,
  onRetry,
  onCancel,
  onOpenTask,
}: {
  agent: AgentDockAgent | null;
  runs: SpaceRun[];
  conversations: Array<{ id: string; title: string; updatedAt: number }>;
  running: boolean;
  loading: boolean;
  details: Record<string, SpaceRunDetail>;
  actingRunId?: string;
  actionError?: string;
  onDecide: (runId: string, approved: boolean) => void;
  onRetry: (runId: string) => void;
  onCancel: (runId: string) => void;
  onOpenTask?: (taskId: string) => void;
}) {
  if (!agent) return <DockEmpty title="No Agent selected" description="Choose a teammate first." />;
  const visibleRuns = runs.slice(0, 30);
  return (
    <ScrollArea className="h-full">
      <div className="grid gap-4 p-4">
        <section className="rounded-lg border border-border/70 p-3">
          <div className="flex items-center gap-2">
            {running ? (
              <Clock3 className="size-4 text-amber-500" />
            ) : (
              <CheckCircle2 className="size-4 text-emerald-500" />
            )}
            <strong className="text-sm">{running ? "Working now" : "Ready for work"}</strong>
          </div>
          <p className="mb-0 mt-1 text-xs text-muted-foreground">
            Direct chats are private. Assigned work and its receipts stay visible to the Space.
          </p>
        </section>
        {loading ? <p className="m-0 text-xs text-muted-foreground">Loading work…</p> : null}
        {actionError ? (
          <p
            className="m-0 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
            role="alert"
          >
            {actionError}
          </p>
        ) : null}
        {visibleRuns.length ? (
          <section className="grid gap-2" aria-label="Recent Agent runs">
            <p className="m-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Recent Space work
            </p>
            {visibleRuns.map((run) => {
              const detail = details[run.id];
              const pendingApproval = detail?.approvals.find(
                (approval) => approval.state === "pending",
              );
              const active = ["queued", "running", "cooldown"].includes(run.state);
              const canRetry = ["failed", "completed_with_errors", "canceled"].includes(run.state);
              const result = runResultSummary(run);
              return (
                <article key={run.id} className="grid gap-2 rounded-lg border border-border/70 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="truncate text-xs capitalize">
                      {run.trigger_kind.split("_").join(" ")}
                    </strong>
                    <RunStateBadge state={run.state} />
                  </div>
                  <p className="mb-0 mt-1 text-[11px] text-muted-foreground">
                    {new Date(run.updated_at || run.created_at).toLocaleString()}
                  </p>
                  {run.source_task_id && onOpenTask ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-fit px-2 text-xs"
                      onClick={() => onOpenTask(run.source_task_id!)}
                    >
                      <ExternalLink className="size-3.5" />
                      Open assigned task
                    </Button>
                  ) : null}
                  {active ? (
                    <div className="grid gap-1" aria-label={`${run.progress}% complete`}>
                      <Progress value={run.progress} className="h-1.5" />
                      <span className="text-[11px] text-muted-foreground">
                        {run.progress}% complete
                      </span>
                    </div>
                  ) : null}
                  {pendingApproval ? (
                    <section className="grid gap-2 rounded-md border border-amber-500/35 bg-amber-500/8 p-2.5">
                      <div>
                        <strong className="text-xs">Needs your approval</strong>
                        <p className="mb-0 mt-1 text-xs text-muted-foreground">
                          {pendingApproval.action_summary || "Review the proposed Agent action."}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          className="h-7"
                          disabled={actingRunId === run.id}
                          onClick={() => onDecide(run.id, true)}
                        >
                          Approve
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7"
                          disabled={actingRunId === run.id}
                          onClick={() => onDecide(run.id, false)}
                        >
                          Reject
                        </Button>
                      </div>
                    </section>
                  ) : null}
                  {result ? (
                    <section className="rounded-md bg-muted/45 p-2.5">
                      <strong className="text-xs">Result</strong>
                      <p className="mb-0 mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                        {result}
                      </p>
                    </section>
                  ) : null}
                  {detail?.actions.length ? (
                    <p className="m-0 text-[11px] text-muted-foreground">
                      {detail.actions.length} audited action{detail.actions.length === 1 ? "" : "s"}
                    </p>
                  ) : null}
                  {run.error_message ? (
                    <p className="mb-0 mt-2 text-xs text-destructive">{run.error_message}</p>
                  ) : null}
                  {active || canRetry ? (
                    <div className="flex gap-2">
                      {active ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7"
                          disabled={actingRunId === run.id}
                          onClick={() => onCancel(run.id)}
                        >
                          <Square className="size-3" />
                          Cancel
                        </Button>
                      ) : null}
                      {canRetry ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7"
                          disabled={actingRunId === run.id}
                          onClick={() => onRetry(run.id)}
                        >
                          <RotateCcw className="size-3.5" />
                          Retry
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </section>
        ) : conversations.length ? (
          <section className="grid gap-2" aria-label="Private Agent chats">
            <p className="m-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Private chats
            </p>
            {conversations.slice(0, 12).map((conversation) => (
              <div key={conversation.id} className="flex items-center gap-2 rounded-md px-2 py-1.5">
                <MessageSquare size={14} className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-xs">{conversation.title}</span>
              </div>
            ))}
          </section>
        ) : (
          <DockEmpty
            title="No work yet"
            description="Start a private chat or assign this Agent a Space task."
          />
        )}
      </div>
    </ScrollArea>
  );
}

function runResultSummary(run: SpaceRun): string {
  const result = firstReadableValue(run.result);
  if (result) return result;
  return firstReadableValue(run.outputs);
}

function firstReadableValue(value: Record<string, unknown>): string {
  for (const key of ["summary", "message", "response", "result", "output"]) {
    const candidate = value?.[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim().slice(0, 800);
  }
  if (!value || !Object.keys(value).length) return "";
  try {
    return JSON.stringify(value, null, 2).slice(0, 800);
  } catch {
    return "Result recorded.";
  }
}

export function AgentAboutView({
  agent,
  toolbox,
  availableContext,
  loading,
  starterPrompts,
  onUseStarter,
  onCreateAgent,
  onManageAgents,
}: {
  agent: AgentDockAgent | null;
  toolbox: AgentToolboxAction[];
  availableContext: string[];
  loading: boolean;
  starterPrompts: string[];
  onUseStarter: (prompt: string) => void;
  onCreateAgent: () => void;
  onManageAgents?: () => void;
}) {
  if (!agent) return <DockEmpty title="No Agent selected" description="Choose a teammate first." />;
  const providerActions = toolbox.filter((action) => action.locality === "provider");
  const connectedServices = [
    ...new Set(
      providerActions
        .filter((action) => !action.reasons.some((reason) => reason.code === "connection_required"))
        .map((action) => action.name.split(".")[1])
        .filter(Boolean),
    ),
  ];
  return (
    <ScrollArea className="h-full">
      <div className="grid gap-4 p-4">
        <section className="grid gap-2 rounded-lg border border-border/70 p-4">
          <div className="flex items-center gap-2">
            <AgentAvatar
              agentId={agent.coordinator ? undefined : agent.id}
              avatar={
                agent.coordinator
                  ? { kind: "preset", preset_id: "sparkles", accent: "violet" }
                  : agent.avatar
              }
              legacyIcon={agent.icon}
              name={agent.name}
              className="size-10"
              iconClassName="size-[19px]"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <strong className="truncate text-sm">{agent.name}</strong>
                <Badge variant="secondary">{agent.coordinator ? "Coordinator" : "Agent"}</Badge>
              </div>
              <p className="mb-0 mt-0.5 text-xs text-muted-foreground">{agent.role}</p>
            </div>
          </div>
          {agent.description ? <p className="m-0 text-sm leading-5">{agent.description}</p> : null}
        </section>

        <section className="grid gap-2">
          <div>
            <p className="m-0 text-sm font-semibold">What I can do here</p>
            <p className="mb-0 mt-1 text-xs text-muted-foreground">
              Capabilities are generated from this Agent&apos;s current Toolbox grants.
            </p>
          </div>
          {loading ? <p className="m-0 text-xs text-muted-foreground">Checking Toolbox…</p> : null}
          {toolbox.length ? (
            toolbox.map((action) => (
              <CapabilityRow
                key={action.name}
                label={toolboxActionLabel(action.name)}
                detail={
                  action.available
                    ? `${action.description}${approvalLabel(action.approval)}`
                    : action.reasons.map((reason) => reason.message).join(" ")
                }
                available={action.available}
              />
            ))
          ) : !loading && agent.coordinator ? (
            <p className="m-0 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              Misty&apos;s server-owned Toolbox manual is unavailable. No action will run unless the
              server resolves and authorizes it.
            </p>
          ) : !loading ? (
            <p className="m-0 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              Exact Toolbox details are private to the Agent owner. This teammate can still act only
              within its Space membership and approved grants.
            </p>
          ) : null}
        </section>
        {availableContext.length ? (
          <section className="grid gap-2">
            <p className="m-0 text-sm font-semibold">Context available here</p>
            <div className="flex flex-wrap gap-1.5">
              {availableContext.map((label) => (
                <Badge key={label} variant="outline" className="font-normal">
                  {label}
                </Badge>
              ))}
            </div>
          </section>
        ) : null}
        <section className="grid gap-2">
          <p className="m-0 text-sm font-semibold">Connected services</p>
          {connectedServices.length ? (
            <div className="flex flex-wrap gap-1.5">
              {connectedServices.map((service) => (
                <Badge key={service} variant="outline" className="font-normal capitalize">
                  {service}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="m-0 text-xs text-muted-foreground">
              No connected services are available to this Agent here.
            </p>
          )}
        </section>
        <section className="grid gap-2">
          <p className="m-0 text-sm font-semibold">Try asking</p>
          {starterPrompts.map((prompt) => (
            <Button
              key={prompt}
              type="button"
              variant="outline"
              className="h-auto justify-start whitespace-normal px-3 py-2 text-left text-xs font-normal"
              onClick={() => onUseStarter(prompt)}
            >
              {prompt}
            </Button>
          ))}
        </section>
        <section className="flex flex-wrap gap-2 border-t border-border/60 pt-4">
          <Button type="button" size="sm" variant="outline" onClick={onCreateAgent}>
            <UserPlus size={14} />
            Create Agent
          </Button>
          {onManageAgents ? (
            <Button type="button" size="sm" variant="outline" onClick={onManageAgents}>
              <Settings size={14} />
              Manage Agents
            </Button>
          ) : null}
        </section>
      </div>
    </ScrollArea>
  );
}

function CapabilityRow({
  label,
  detail,
  available,
}: {
  label: string;
  detail: string;
  available: boolean;
}) {
  return (
    <div className={cn("rounded-lg border p-3", !available && "opacity-65")}>
      <div className="flex items-center gap-2">
        {available ? (
          <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
        ) : (
          <AlertTriangle className="size-4 shrink-0 text-amber-500" />
        )}
        <strong className="text-xs">{label}</strong>
      </div>
      <p className="mb-0 mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
    </div>
  );
}

export function DockEmpty({ title, description }: { title: string; description: string }) {
  return (
    <div className="grid min-h-44 place-items-center p-6 text-center">
      <div>
        <Bot className="mx-auto size-6 text-muted-foreground" />
        <p className="mb-0 mt-2 text-sm font-medium">{title}</p>
        <p className="mb-0 mt-1 max-w-64 text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function RunStateBadge({ state }: { state: SpaceRun["state"] }) {
  const attention = state === "awaiting_approval" || state === "failed";
  return (
    <Badge variant={attention ? "destructive" : "outline"} className="shrink-0 capitalize">
      {state.split("_").join(" ")}
    </Badge>
  );
}

function toolboxActionLabel(name: string): string {
  return name
    .split(".")
    .map((part) => part.split("_").join(" "))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" · ");
}

function approvalLabel(approval: AgentToolboxAction["approval"]): string {
  if (approval === "interactive") return " Approval is always required.";
  if (approval === "explicit_intent") return " Runs only after an explicit request.";
  return "";
}
