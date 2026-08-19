import { spacesApi } from "@/api/spaces/api";
import type { Space } from "@/api/spaces/dto/interfaces/types";
import { browserAgentCapabilities } from "@/features/browser/browserAgentAccess";
import { browserScopeId } from "@/features/browser/browserRuntime";
import {
  dockLeaves,
  parseBrowserTabState,
  useWorkspaceStore,
  type WorkspaceTab,
} from "@/features/workspace";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  cn,
} from "@/shared/ui";
import {
  Bot,
  CheckCircle2,
  Clock3,
  CircleAlert,
  MessageCirclePlus,
  Pencil,
  RefreshCcw,
  RotateCcw,
  Square,
} from "lucide-react";
import { useState } from "react";
import type { PersonalAgent, PersonalAgentRunSummary } from "../model/interfaces/personal";
import { ensureServerAgentDevice } from "../store/useAgentDeviceStore";
import { agentsDeviceSnapshot } from "../store/useAgentsStore";
import type { useAgentActivity } from "../useAgentActivity";

export type AgentActivityController = ReturnType<typeof useAgentActivity>;

function phaseLabel(value: string): string {
  return value
    ? value
        .replace(/^used_/, "Used ")
        .replace(/^using_/, "Using ")
        .replace(/_/g, " ")
    : "Waiting";
}

function runStateLabel(value: string): string {
  return value.replace(/_/g, " ");
}

function stepLabel(step: { node_id: string; output: Record<string, unknown> }): string {
  if (step.node_id.startsWith("model:")) {
    return `Thinking · step ${step.node_id.slice("model:".length)}`;
  }
  const tool = typeof step.output.tool === "string" ? step.output.tool : "";
  const names: Record<string, string> = {
    tasks_create: "Create task",
    tasks_update: "Update task",
    tasks_update_assigned: "Update assigned task",
    tasks_query: "Search tasks",
    messages_search: "Search messages",
    messages_send: "Send message",
    library_search: "Search Library",
    calendar_query: "Check calendar",
    attached_files_read: "Read attached files",
    task_activity_write: "Record task progress",
  };
  return names[tool] ?? (tool ? phaseLabel(tool) : phaseLabel(step.node_id));
}

function resultText(result?: Record<string, unknown>): string {
  const text = result?.text;
  return typeof text === "string" ? text.trim() : "";
}

function inputSummary(input: Record<string, unknown>): string {
  const entries = Object.entries(input);
  if (entries.length === 0) return "";
  return entries
    .map(
      ([key, value]) =>
        `${phaseLabel(key)}: ${typeof value === "string" ? value : JSON.stringify(value)}`,
    )
    .join(" · ");
}

function canCancel(run: PersonalAgentRunSummary): boolean {
  return ["queued", "running", "awaiting_approval", "awaiting_device"].includes(run.state);
}

function canRetry(run: PersonalAgentRunSummary): boolean {
  return ["failed", "canceled", "completed_with_errors"].includes(run.state);
}

function elapsedLabel(run: PersonalAgentRunSummary): string {
  const start = new Date(run.created_at).getTime();
  const end = run.completed_at ? new Date(run.completed_at).getTime() : Date.now();
  const seconds = Math.max(0, Math.floor((end - start) / 1_000));
  if (seconds < 60) return `${seconds}s elapsed`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${minutes}m elapsed`
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m elapsed`;
}

export function AgentActivityPanel({
  agent,
  controller,
  onEdit,
}: {
  agent: PersonalAgent;
  controller: AgentActivityController;
  onEdit: () => void;
}) {
  const { activity, runDetail, loading, actingRunId, error, refresh, act, decideApproval } =
    controller;
  const [askOpen, setAskOpen] = useState(false);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [spaceId, setSpaceId] = useState("");
  const [instruction, setInstruction] = useState("");
  const [mode, setMode] = useState(agent.default_run_mode);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const [browserTab, setBrowserTab] = useState<WorkspaceTab | null>(null);
  const [attachBrowser, setAttachBrowser] = useState(false);
  const current = activity?.active_run ?? activity?.runs[0];
  const currentDetail = current && runDetail?.summary.run_id === current.run_id ? runDetail : null;
  const hasFailedSteps = Boolean(
    current?.has_failed_steps || currentDetail?.steps.some((step) => step.state === "failed"),
  );
  const displayState =
    current?.state === "completed" && hasFailedSteps ? "completed_with_errors" : current?.state;
  const finalResponse = resultText(currentDetail?.result);
  const openAsk = async () => {
    setAskOpen(true);
    setStartError("");
    const availableBrowser = latestBrowserTab();
    setBrowserTab(availableBrowser);
    setAttachBrowser(Boolean(availableBrowser));
    try {
      const snapshot = await spacesApi.snapshot();
      setSpaces(snapshot.spaces);
      setSpaceId((value) => value || snapshot.spaces[0]?.id || "");
    } catch (reason) {
      setStartError(reason instanceof Error ? reason.message : "Spaces could not be loaded.");
    }
  };
  const startRun = async () => {
    if (!spaceId || !instruction.trim() || starting) return;
    setStarting(true);
    setStartError("");
    try {
      const context_references = [];
      if (attachBrowser && browserTab) {
        const snapshot = await agentsDeviceSnapshot();
        if (!snapshot.device || snapshot.device.status === "revoked") {
          throw new Error("This device is unavailable for Browser work.");
        }
        const device = await ensureServerAgentDevice(snapshot.device);
        context_references.push({
          device_id: device.id,
          kind: "browser_tab" as const,
          opaque_ref: browserScopeId(browserTab),
          display_name: browserTab.title || "Browser tab",
          capabilities: [...browserAgentCapabilities],
        });
      }
      await spacesApi.startAgentRun(spaceId, agent.id, {
        instruction: instruction.trim(),
        mode,
        context_references,
      });
      setInstruction("");
      setAskOpen(false);
      await refresh();
    } catch (reason) {
      setStartError(reason instanceof Error ? reason.message : "Agent work could not be started.");
    } finally {
      setStarting(false);
    }
  };
  return (
    <section
      aria-label={`${agent.name} activity`}
      className="misty-transient-scrollbar min-h-0 overflow-y-auto bg-charcoal-bg"
    >
      <div className="mx-auto grid max-w-3xl gap-5 px-8 py-7">
        <header className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-charcoal-border bg-charcoal-card text-cream">
              <Bot size={19} />
            </span>
            <div className="min-w-0">
              <h1 className="m-0 truncate text-lg font-medium text-cream-bright">{agent.name}</h1>
              <p className="m-0 mt-1 text-xs capitalize text-cream-muted">
                {activity?.work_state ?? (loading ? "Loading activity" : "Ready")}
                {activity?.queue_count ? ` · ${activity.queue_count} queued` : ""}
              </p>
            </div>
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" onClick={() => void openAsk()}>
              <MessageCirclePlus size={13} /> Ask Agent
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={loading}>
              <RefreshCcw size={13} /> Refresh
            </Button>
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Pencil size={13} /> Preferences
            </Button>
          </div>
        </header>
        {error ? (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        ) : null}
        {current ? (
          <article className="rounded-xl border border-charcoal-border bg-charcoal-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wider text-cream-muted">
                  {canCancel(current) ? "Current work" : "Latest work"}
                </div>
                <h2 className="mb-0 mt-1 truncate text-[15px] font-medium text-cream-bright">
                  {current.task_id
                    ? `${current.task_key} · ${current.task_title}`
                    : current.trigger_kind === "delegated"
                      ? "Delegated work"
                      : "Direct instruction"}
                </h2>
                <p className="mb-0 mt-1 text-xs capitalize text-cream-muted">
                  {current.space_name} ·{" "}
                  {canCancel(current)
                    ? phaseLabel(current.phase)
                    : displayState === "completed"
                      ? "Finished"
                      : displayState === "completed_with_errors"
                        ? "Finished with issues"
                        : phaseLabel(current.phase)}
                </p>
              </div>
              <span className="rounded-full border border-charcoal-border px-2 py-1 text-[10px] capitalize text-cream-muted">
                {runStateLabel(displayState ?? current.state)}
              </span>
            </div>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-charcoal-hover">
              <div
                className={cn(
                  "h-full rounded-full transition-[width]",
                  displayState === "completed_with_errors" || displayState === "failed"
                    ? "bg-amber-400"
                    : "bg-emerald-500",
                )}
                style={{ width: `${Math.max(4, current.progress)}%` }}
              />
            </div>
            {current.error_message || hasFailedSteps ? (
              <div
                role="alert"
                className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2.5"
              >
                <div className="flex items-center gap-1.5 text-xs font-medium text-red-300">
                  <CircleAlert size={13} />
                  {displayState === "completed_with_errors"
                    ? "What needs attention"
                    : "Why it stopped"}
                </div>
                <p className="mb-0 mt-1 whitespace-pre-wrap text-xs leading-5 text-cream">
                  {current.error_message || "One or more actions could not be completed."}
                </p>
                {current.error_code ? (
                  <p className="mb-0 mt-1 text-[10px] text-cream-muted">
                    Error code: {current.error_code}
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-[11px] text-cream-muted">
                <Clock3 size={12} /> {elapsedLabel(current)} · Attempt {current.attempt}
              </span>
              {canCancel(current) ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={actingRunId === current.run_id}
                  onClick={() => void act(current.run_id, "cancel")}
                >
                  <Square size={12} /> Cancel
                </Button>
              ) : canRetry(current) || hasFailedSteps ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={actingRunId === current.run_id}
                  onClick={() => void act(current.run_id, "retry")}
                >
                  <RotateCcw size={12} /> Retry
                </Button>
              ) : null}
            </div>
          </article>
        ) : (
          <div className="rounded-xl border border-dashed border-charcoal-border px-5 py-10 text-center">
            <CheckCircle2 className="mx-auto text-emerald-500" size={24} />
            <h2 className="mb-0 mt-3 text-sm font-medium text-cream-bright">
              Ready for assigned work
            </h2>
            <p className="mb-0 mt-1 text-xs text-cream-muted">
              Assign this Agent a task from a Space to start a background run.
            </p>
          </div>
        )}
        {currentDetail?.instruction ? (
          <section className="rounded-xl border border-charcoal-border bg-charcoal-card p-4">
            <h2 className="m-0 text-[11px] font-medium uppercase tracking-wider text-cream-muted">
              Requested
            </h2>
            <p className="mb-0 mt-2 whitespace-pre-wrap text-sm leading-6 text-cream-bright">
              {currentDetail.instruction}
            </p>
          </section>
        ) : null}
        {finalResponse ? (
          <section className="rounded-xl border border-charcoal-border bg-charcoal-card p-4">
            <h2 className="m-0 text-[11px] font-medium uppercase tracking-wider text-cream-muted">
              Agent response
            </h2>
            <p className="mb-0 mt-2 whitespace-pre-wrap text-sm leading-6 text-cream">
              {finalResponse}
            </p>
          </section>
        ) : null}
        {currentDetail?.approvals.some((approval) => approval.state === "pending") ? (
          <section>
            <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-cream-muted">
              Approval needed
            </h2>
            <div className="grid gap-2">
              {currentDetail.approvals
                .filter((approval) => approval.state === "pending")
                .map((approval) => (
                  <article
                    key={approval.id}
                    className="rounded-lg border border-amber-400/25 bg-amber-400/5 p-3"
                  >
                    <p className="m-0 text-sm font-medium text-cream-bright">
                      {approval.summary || approval.tool_name}
                    </p>
                    <p className="mb-3 mt-1 text-xs text-cream-muted">
                      Exact action: {approval.tool_name}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={actingRunId === approval.run_id}
                        onClick={() => void decideApproval(approval.run_id, approval.id, "approve")}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={actingRunId === approval.run_id}
                        onClick={() => void decideApproval(approval.run_id, approval.id, "deny")}
                      >
                        Deny
                      </Button>
                    </div>
                  </article>
                ))}
            </div>
          </section>
        ) : null}
        {currentDetail?.activity.length ? (
          <section>
            <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-cream-muted">
              Run activity
            </h2>
            <ol className="m-0 grid list-none gap-1.5 p-0">
              {currentDetail.activity.map((item) => (
                <li
                  key={item.id}
                  className="rounded-lg border border-charcoal-border bg-charcoal-sidebar px-3 py-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] capitalize text-cream-muted">{item.kind}</span>
                    <time className="text-[10px] text-cream-muted">
                      {new Date(item.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                  <p className="mb-0 mt-1 whitespace-pre-wrap text-xs leading-5 text-cream">
                    {item.message}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
        {currentDetail?.steps.length ? (
          <section>
            <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-cream-muted">
              Work log
            </h2>
            <ol className="m-0 grid list-none gap-1.5 p-0">
              {currentDetail.steps
                .slice(-12)
                .reverse()
                .map((step) => (
                  <li
                    key={step.id}
                    className="rounded-lg border border-charcoal-border bg-charcoal-sidebar px-3 py-2.5"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-xs text-cream">{stepLabel(step)}</span>
                      <span
                        className={`shrink-0 text-[10px] capitalize ${step.state === "failed" ? "text-red-300" : "text-cream-muted"}`}
                      >
                        {runStateLabel(step.state)}
                      </span>
                    </div>
                    {inputSummary(step.input) ? (
                      <p className="mb-0 mt-1 line-clamp-2 text-[11px] leading-5 text-cream-muted">
                        {inputSummary(step.input)}
                      </p>
                    ) : null}
                    {step.error_message ? (
                      <p className="mb-0 mt-1 text-[11px] leading-5 text-red-300">
                        {step.error_message}
                      </p>
                    ) : null}
                  </li>
                ))}
            </ol>
          </section>
        ) : null}
      </div>
      <Dialog open={askOpen} onOpenChange={(open) => !starting && setAskOpen(open)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Ask {agent.name}</DialogTitle>
            <DialogDescription>
              Choose one Space for this run. The Agent acts with your current authority there.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Select value={spaceId} onValueChange={setSpaceId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a Space" />
              </SelectTrigger>
              <SelectContent>
                {spaces.map((space) => (
                  <SelectItem key={space.id} value={space.id}>
                    {space.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              maxLength={32_000}
              rows={7}
              placeholder="What should your Agent do?"
            />
            <Select value={mode} onValueChange={(value) => setMode(value as typeof mode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ask">Ask for approval</SelectItem>
                <SelectItem value="auto">Approve routine work</SelectItem>
                <SelectItem value="full">Full access</SelectItem>
              </SelectContent>
            </Select>
            {browserTab ? (
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-charcoal-border px-3 py-2.5 text-xs text-cream">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={attachBrowser}
                  onChange={(event) => setAttachBrowser(event.target.checked)}
                />
                <span>
                  <span className="block font-medium">Attach Browser tab</span>
                  <span className="mt-0.5 block text-cream-muted">
                    {browserTab.title} · {browserHost(browserTab)}
                  </span>
                </span>
              </label>
            ) : null}
            <p className="m-0 text-xs text-cream-muted">
              Dangerous actions always require approval.
            </p>
            {startError ? (
              <p role="alert" className="m-0 text-xs text-red-300">
                {startError}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" disabled={starting} onClick={() => setAskOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={starting || !spaceId || !instruction.trim()}
              onClick={() => void startRun()}
            >
              {starting ? "Starting…" : "Start work"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function latestBrowserTab(): WorkspaceTab | null {
  const tabs = dockLeaves(useWorkspaceStore.getState().layout.root)
    .flatMap((pane) => pane.tabs)
    .filter((tab) => tab.surfaceId === "browser")
    .sort((left, right) => right.lastFocusedAt - left.lastFocusedAt);
  return tabs[0] ?? null;
}

function browserHost(tab: WorkspaceTab): string {
  try {
    return new URL(parseBrowserTabState(tab.state).url).hostname || "current page";
  } catch {
    return "current page";
  }
}
