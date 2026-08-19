import type { SpaceMessage } from "@/api/spaces/dto/interfaces/types";
import { messageReplyPreviewText } from "@/features/spaces/chat";
import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  cn,
} from "@/shared/ui";
import { RotateCcw, StopCircle, Volume2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { AgentAvatar } from "../AgentAvatar";
import type { PersonalAgent, PersonalAgentRunSummary } from "../model/interfaces/personal";
import type { useAgentActivity } from "../useAgentActivity";

type AgentActivityController = ReturnType<typeof useAgentActivity>;

export function ConversationMessage({
  message,
  agent,
  run,
  playing,
  hasAudio,
  onAudio,
  onRetry,
  retrying = false,
  onDetails,
}: {
  message: SpaceMessage;
  agent: PersonalAgent;
  run?: PersonalAgentRunSummary;
  playing: boolean;
  hasAudio: boolean;
  onAudio: () => void;
  onRetry?: () => void;
  retrying?: boolean;
  onDetails: () => void;
}) {
  const person = message.sender_kind === "person";
  const failed = run && ["failed", "completed_with_errors", "canceled"].includes(run.state);
  const messageText = messageReplyPreviewText(message);
  const visibleText = failed ? friendlyRunError(messageText || run.error_message) : messageText;
  return (
    <article className={cn("flex gap-2.5", person && "justify-end")}>
      {!person ? (
        <AgentAvatar
          agentId={agent.id}
          avatar={agent.avatar}
          legacyIcon={agent.icon}
          name={agent.name}
          className="mt-1 size-7"
          iconClassName="size-3.5"
        />
      ) : null}
      <div className={cn("min-w-0 max-w-[78%]", person && "text-right")}>
        <div
          className={cn(
            "inline-block rounded-2xl px-3.5 py-2.5 text-left text-sm leading-6",
            person
              ? "bg-cream-bright text-charcoal-bg"
              : "border border-charcoal-border bg-charcoal-card text-cream",
          )}
        >
          <ReactMarkdown>{visibleText}</ReactMarkdown>
        </div>
        <div
          className={cn(
            "mt-1 flex items-center gap-2 text-[10px] text-cream-muted",
            person && "justify-end",
          )}
        >
          {message.local_delivery_state === "sending" ? <span>Sending…</span> : null}
          {message.local_delivery_state === "failed" ? (
            <span className="text-red-300">Not sent</span>
          ) : null}
          {run?.state === "queued" ? <span>Queued</span> : null}
          {hasAudio && !person ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 hover:text-cream"
              onClick={onAudio}
            >
              {playing ? <StopCircle className="size-3" /> : <Volume2 className="size-3" />}
              {playing ? "Stop" : "Replay"}
            </button>
          ) : null}
          {failed ? (
            <>
              <button
                type="button"
                className="inline-flex items-center gap-1 hover:text-cream"
                onClick={onRetry}
                disabled={retrying}
              >
                <RotateCcw className={cn("size-3", retrying && "animate-spin")} />
                {retrying ? "Retrying…" : "Retry"}
              </button>
              <button type="button" className="hover:text-cream" onClick={onDetails}>
                Details
              </button>
            </>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function InlineApproval({ controller }: { controller: AgentActivityController }) {
  const run = controller.activity?.active_run;
  const approval = controller.runDetail?.approvals.find((item) => item.state === "pending");
  if (!run || !approval) return null;
  return (
    <div className="ml-9 max-w-lg rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
      <p className="m-0 text-sm font-medium text-cream-bright">Approve this action?</p>
      <p className="mb-3 mt-1 text-xs text-cream-muted">{approval.summary || approval.tool_name}</p>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => void controller.decideApproval(run.run_id, approval.id, "approve")}
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void controller.decideApproval(run.run_id, approval.id, "deny")}
        >
          Deny
        </Button>
      </div>
    </div>
  );
}

export function AgentActivityDrawer({
  open,
  onOpenChange,
  controller,
  runs,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  controller: AgentActivityController;
  runs: PersonalAgentRunSummary[];
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="misty-transient-scrollbar overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Activity</SheetTitle>
          <SheetDescription>Recent work in this conversation.</SheetDescription>
        </SheetHeader>
        <div className="mt-6 grid gap-2">
          {runs.map((run) => (
            <div
              key={run.run_id}
              className="rounded-xl border border-charcoal-border bg-charcoal-bg p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="m-0 text-sm text-cream">{friendlyRunState(run.state)}</p>
                  <p className="mb-0 mt-1 text-xs text-cream-muted">
                    {new Date(run.created_at).toLocaleString()}
                  </p>
                </div>
                <RunActions run={run} controller={controller} />
              </div>
              <button
                type="button"
                className="mt-2 text-xs text-cream-muted hover:text-cream"
                onClick={() => void controller.loadDetail(run.run_id)}
              >
                {controller.runDetail?.summary.run_id === run.run_id
                  ? "Details loaded"
                  : "View details"}
              </button>
              {run.error_message ? (
                <p className="mb-0 mt-2 text-xs text-red-300">
                  {friendlyRunError(run.error_message)}
                </p>
              ) : null}
              {controller.runDetail?.summary.run_id === run.run_id ? (
                <details className="mt-3 text-xs text-cream-muted">
                  <summary className="cursor-pointer">Advanced details</summary>
                  <div className="mt-2 grid gap-1">
                    {controller.runDetail.steps.map((step) => (
                      <div
                        key={step.id}
                        className="rounded border border-charcoal-border px-2 py-1"
                      >
                        {step.node_id} · {step.state}
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          ))}
          {runs.length === 0 ? <p className="text-sm text-cream-muted">No activity yet.</p> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function RunActions({
  run,
  controller,
}: {
  run: PersonalAgentRunSummary;
  controller: AgentActivityController;
}) {
  const canCancel = ["queued", "running", "awaiting_approval", "awaiting_device"].includes(
    run.state,
  );
  const canRetry = ["failed", "canceled", "completed_with_errors"].includes(run.state);
  return (
    <div className="flex gap-1">
      {canCancel ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => void controller.act(run.run_id, "cancel")}
        >
          Cancel
        </Button>
      ) : null}
      {canRetry ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => void controller.act(run.run_id, "retry")}
        >
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function ContextChip({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-charcoal-border bg-charcoal-bg px-2 py-1 text-[10px] text-cream-muted">
      {label}
      {onRemove ? (
        <button type="button" onClick={onRemove}>
          ×
        </button>
      ) : null}
    </span>
  );
}

function friendlyRunState(state: string) {
  const labels: Record<string, string> = {
    queued: "Queued",
    running: "Working",
    awaiting_approval: "Waiting for your approval",
    awaiting_device: "Waiting for this device",
    completed: "Completed",
    completed_with_errors: "Finished with an issue",
    failed: "Could not finish",
    canceled: "Canceled",
  };
  return labels[state] ?? state;
}

export function friendlyRunError(value?: string): string {
  const text = (value ?? "").trim();
  if (!text) return "The agent could not complete that action. You can retry it.";
  if (/dueAt|ISO 8601|due date/i.test(text)) {
    return "The due date could not be understood. Retry with a specific date and time.";
  }
  if (/\{\s*"?(fatal|name)"?|FatalError|agent_runtime_failed/i.test(text)) {
    return "The agent hit a temporary problem while performing that action. You can retry it.";
  }
  return text
    .replace(/^[a-z0-9_]+:\s*/i, "")
    .replace(/\s*\{.*$/s, "")
    .trim()
    .slice(0, 500);
}
