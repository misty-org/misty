import type { AssistantPlanOperation } from "@/models/types/features/explorer/desktop/ExplorerAssistantMessage";
export type { AssistantPlanOperation } from "@/models/types/features/explorer/desktop/ExplorerAssistantMessage";
import { File, Folder, Sparkles, User } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AgentSources } from "@/features/agents/AgentSources";
import "@/features/agents/sources.css";
import { Avatar, AvatarFallback } from "@/ui";
import { Badge } from "@/ui";
import { Button } from "@/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui";
import { safeTauriAssetUrl } from "@/platform/tauri";
import type { AiPanelMessage } from "@/models/types/stores/assistant/useMikaSessionStore";
import type {
  AiPlanReview,
  AiToolApproval,
} from "@/models/interfaces/stores/assistant/useMikaSessionStore";
import { cx } from "./ExplorerDesktopShared";
import { assistantPanelStyles } from "./ExplorerAssistantStyles";

export function AssistantMessage(props: {
  message: AiPanelMessage;
  running: boolean;
  plans: AiPlanReview[];
  toolApprovals: AiToolApproval[];
  onApplyPlan: (planId: string) => Promise<void>;
  onApproveTool: (requestId: string) => Promise<void>;
  /** Full-width conversation styling (avatar + name rows) to match Space chat. */
  spacious?: boolean;
}) {
  const { message } = props;
  const citedContextSources = useMemo(() => {
    const citedIds = new Set(
      [...message.text.matchAll(/\[(S\d+)\]/gi)].map((match) => match[1].toUpperCase()),
    );
    return (message.contextSources ?? []).filter((source) => citedIds.has(source.id.toUpperCase()));
  }, [message.contextSources, message.text]);
  const text = message.text || (message.role === "assistant" && props.running ? "Thinking..." : "");
  const extras = (
    <>
      {message.citations?.length ? <AgentSources citations={message.citations} compact /> : null}
      {citedContextSources.length ? (
        <div
          className="flex min-w-0 flex-wrap items-center gap-1.5 pt-0.5"
          aria-label="Space sources"
        >
          {citedContextSources.map((source) => (
            <Button
              key={`${message.id}:${source.id}`}
              asChild
              className="h-7 max-w-full gap-1 px-2 text-[11px] shadow-none"
              size="sm"
              variant="outline"
            >
              <Link to={source.href} title={source.label}>
                <span className="shrink-0 text-muted-foreground">[{source.id}]</span>
                <span className="truncate">{source.label}</span>
              </Link>
            </Button>
          ))}
        </div>
      ) : null}
      {message.hostedAiUsedRatio !== undefined ? (
        <small className="text-[10px] text-muted-foreground">
          {Math.round(message.hostedAiUsedRatio * 100)}% of weekly hosted AI used
          {message.hostedAiResetAt
            ? ` · resets ${new Date(message.hostedAiResetAt).toLocaleDateString()}`
            : ""}
        </small>
      ) : null}
      {message.toolRequestId ? (
        <AssistantToolActions
          requestId={message.toolRequestId}
          approvals={props.toolApprovals}
          onApprove={props.onApproveTool}
        />
      ) : null}
      {message.planId ? (
        <AssistantPlanActions
          planId={message.planId}
          plans={props.plans}
          onApply={props.onApplyPlan}
        />
      ) : null}
    </>
  );

  if (props.spacious) {
    return (
      <article className="group grid grid-cols-[40px_minmax(0,1fr)] gap-x-4 rounded-md py-1 [&:not(:first-child)]:mt-5">
        <div className="col-start-1 flex justify-end">
          <Avatar className="mt-0.5 size-10">
            <AvatarFallback className="text-xs font-semibold">
              {message.role === "user" ? <User className="size-5" /> : "AI"}
            </AvatarFallback>
          </Avatar>
        </div>
        <div className="col-start-2 grid min-w-0 gap-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 leading-5">
            <strong className="text-[15px] font-semibold text-foreground">
              {assistantMessageTitle(message.role)}
            </strong>
            {message.role === "assistant" ? (
              <Badge
                variant="secondary"
                className="h-4 gap-1 rounded px-1 text-[9px] uppercase"
              >
                <Sparkles />
                Agent
              </Badge>
            ) : null}
          </div>
          <p
            className={cx(
              "m-0 whitespace-pre-wrap break-words text-[15px] leading-6",
              message.role === "error" ? "text-destructive" : "text-foreground/90",
            )}
          >
            {text}
          </p>
          {extras}
        </div>
      </article>
    );
  }

  return (
    <article className={assistantMessageClass(message.role)}>
      <strong className={assistantPanelStyles.messageTitle}>
        {assistantMessageTitle(message.role)}
      </strong>
      <pre className={assistantPanelStyles.messageText}>{text}</pre>
      {extras}
    </article>
  );
}

function assistantMessageClass(role: string): string {
  return cx(
    assistantPanelStyles.message,
    role === "user" && assistantPanelStyles.userMessage,
    role === "tool" && assistantPanelStyles.toolMessage,
    role === "error" && assistantPanelStyles.errorMessage,
  );
}

function assistantMessageTitle(role: AiPanelMessage["role"]): string {
  if (role === "user") return "You";
  if (role === "tool") return "Tool";
  if (role === "error") return "Error";
  if (role === "plan") return "Plan";
  return "Agent";
}

function AssistantPlanActions(props: {
  planId: string;
  plans: AiPlanReview[];
  onApply: (planId: string) => Promise<void>;
}) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const plan = props.plans.find((candidate) => candidate.id === props.planId);
  if (!plan) return null;
  const blocked = plan.blockedReasons.length > 0;
  return (
    <div className={assistantPanelStyles.planDetails}>
      <div className={assistantPanelStyles.planActions}>
        <span className={assistantPanelStyles.runningBadge}>
          {plan.plan.operations.length} operations
          {blocked ? " blocked" : plan.applied ? " queued" : ""}
        </span>
        <Button variant="outline" size="sm" type="button" onClick={() => setReviewOpen(true)}>
          {plan.applied ? "View" : "Review & Apply"}
        </Button>
      </div>
      <AssistantPlanReviewDialog
        open={reviewOpen}
        plan={plan}
        onApply={props.onApply}
        onOpenChange={setReviewOpen}
      />
    </div>
  );
}

function AssistantToolActions(props: {
  requestId: string;
  approvals: AiToolApproval[];
  onApprove: (requestId: string) => Promise<void>;
}) {
  const approval = props.approvals.find((candidate) => candidate.id === props.requestId);
  if (!approval) return null;
  return (
    <div className={assistantPanelStyles.planActions}>
      <span className={assistantPanelStyles.runningBadge}>
        {approval.completed ? "Completed" : approval.error ? "Blocked" : "Needs approval"}
      </span>
      <Button
        variant="outline"
        size="sm"
        type="button"
        disabled={approval.running || approval.completed}
        onClick={() => void props.onApprove(props.requestId)}
      >
        {approval.running ? "Running..." : approval.completed ? "Ran" : "Run"}
      </Button>
    </div>
  );
}

function AssistantPlanReviewDialog(props: {
  open: boolean;
  plan: AiPlanReview;
  onApply: (planId: string) => Promise<void>;
  onOpenChange: (open: boolean) => void;
}) {
  const blocked = props.plan.blockedReasons.length > 0;
  const warnings = [
    ...props.plan.plan.warnings.map((warning) => `Warning: ${warning}`),
    ...props.plan.blockedReasons.map((reason) => `Blocked: ${reason}`),
  ];
  const groupedOperations = useMemo(() => {
    const groups = new Map<string, AssistantPlanOperation[]>();
    for (const operation of props.plan.plan.operations) {
      const group = planOperationGroup(operation);
      groups.set(group, [...(groups.get(group) ?? []), operation]);
    }
    return [...groups.entries()];
  }, [props.plan.plan.operations]);

  const applyPlan = async () => {
    await props.onApply(props.plan.id);
    props.onOpenChange(false);
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="flex max-h-[min(820px,calc(100vh-64px))] w-[min(1040px,calc(100vw-64px))] max-w-none flex-col gap-0 overflow-hidden bg-popover p-0 text-popover-foreground">
        <DialogHeader className="border-b border-border px-5 py-4 pr-12">
          <DialogTitle>Review File Operations</DialogTitle>
          <DialogDescription>
            {props.plan.plan.operations.length} proposed operations
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 gap-4 overflow-auto p-5">
          <div className="grid gap-3 md:grid-cols-2">
            <PlanSummary label="What the agent will do" text={props.plan.plan.summary} />
            {props.plan.appliedSummary ? (
              <PlanSummary label="What Misty queued" text={props.plan.appliedSummary} />
            ) : null}
          </div>
          {warnings.length > 0 ? (
            <p className="m-0 rounded-md bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive">
              {warnings.join(" ")}
            </p>
          ) : null}
          <div className="grid gap-4">
            {groupedOperations.map(([destination, operations]) => (
              <section className="overflow-hidden rounded-lg bg-muted/30" key={destination}>
                <header className="flex min-w-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                      <Folder size={16} />
                    </span>
                    <div className="min-w-0">
                      <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Destination
                      </span>
                      <strong className="block truncate text-sm" title={destination}>
                        {destination}
                      </strong>
                    </div>
                  </div>
                  <Badge variant="secondary">
                    {operations.length} item{operations.length === 1 ? "" : "s"}
                  </Badge>
                </header>
                <div className="divide-y divide-border">
                  {operations.map((operation, index) => (
                    <PlanOperationRow
                      key={`${operation.type}-${index}-${planOperationDetail(operation)}`}
                      operation={operation}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
        <DialogFooter className="mt-0 flex-row flex-wrap items-center justify-between border-t border-border px-5 py-4 sm:justify-between">
          <span className={assistantPanelStyles.runningBadge}>
            {props.plan.plan.operations.length} operations
            {blocked ? " blocked" : props.plan.applied ? " queued" : ""}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" type="button" onClick={() => props.onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={blocked || props.plan.applied || props.plan.applying}
              onClick={() => void applyPlan()}
            >
              {props.plan.applying ? "Queueing..." : props.plan.applied ? "Queued" : "Apply"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlanSummary(props: { label: string; text: string }) {
  return (
    <section className="grid gap-1 rounded-lg bg-muted/40 px-3.5 py-3">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {props.label}
      </span>
      <p className="m-0 min-w-0 break-words text-sm leading-relaxed">{props.text}</p>
    </section>
  );
}

function PlanOperationRow(props: { operation: AssistantPlanOperation }) {
  const { operation } = props;
  const preview = planOperationPreview(operation);
  const confidence = operation.type === "mkdir" ? null : operation.confidence;
  return (
    <article className="grid min-w-0 grid-cols-[52px_minmax(0,1fr)] gap-3 px-4 py-3">
      <div className="grid size-[52px] place-items-center overflow-hidden rounded-md bg-muted text-muted-foreground">
        {preview ? (
          <img alt="" className="size-full object-cover" src={preview} />
        ) : operation.type === "mkdir" ? (
          <Folder size={22} />
        ) : (
          <File size={21} />
        )}
      </div>
      <div className="grid min-w-0 gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="capitalize">
            {operation.type}
          </Badge>
          {typeof confidence === "number" ? (
            <span className="text-[11px] text-muted-foreground">
              {Math.round(confidence * 100)}% confidence
            </span>
          ) : null}
        </div>
        {operation.type === "mkdir" ? (
          <PathDetail label="Create folder" path={operation.path} />
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            <PathDetail label="From" path={planOperationSource(operation)} />
            <PathDetail label="To" path={planOperationDestination(operation)} />
          </div>
        )}
        <p className="m-0 text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Why: </span>
          {operation.reason || "No reason provided."}
        </p>
      </div>
    </article>
  );
}

function PathDetail(props: { label: string; path: string }) {
  return (
    <div className="min-w-0">
      <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {props.label}
      </span>
      <span className="mt-1 block break-all text-xs leading-relaxed">{props.path}</span>
    </div>
  );
}

function planOperationDetail(operation: AssistantPlanOperation): string {
  return operation.type === "mkdir" ? operation.path : `${operation.from} -> ${operation.to}`;
}

function planOperationSource(operation: AssistantPlanOperation): string {
  return operation.type === "mkdir" ? "-" : operation.from;
}

function planOperationDestination(operation: AssistantPlanOperation): string {
  return operation.type === "mkdir" ? operation.path : operation.to;
}

function planOperationGroup(operation: AssistantPlanOperation): string {
  const destination = planOperationDestination(operation).replace(/[\\/]+$/, "");
  const separator = Math.max(destination.lastIndexOf("/"), destination.lastIndexOf("\\"));
  if (operation.type === "mkdir") return destination;
  return separator > 0 ? destination.slice(0, separator) : "Destination";
}

function planOperationPreview(operation: AssistantPlanOperation): string | null {
  if (operation.type === "mkdir") return null;
  const extension = operation.from.split(".").pop()?.toLowerCase() ?? "";
  return [
    "jpg",
    "jpeg",
    "png",
    "webp",
    "gif",
    "bmp",
    "tif",
    "tiff",
    "heic",
    "heif",
    "avif",
  ].includes(extension)
    ? safeTauriAssetUrl(operation.from)
    : null;
}
