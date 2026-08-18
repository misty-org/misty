import { Button } from "@/shared/ui";
import { Bot, CheckCircle2, Clock3, Pencil, RefreshCcw, RotateCcw, Square } from "lucide-react";
import type { PersonalAgent, PersonalAgentRunSummary } from "../model/interfaces/personal";
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

function canCancel(run: PersonalAgentRunSummary): boolean {
  return run.state === "queued" || run.state === "running";
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
  const { activity, runDetail, loading, actingRunId, error, refresh, act } = controller;
  const current = activity?.active_run ?? activity?.runs[0];
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
                  {current.task_key} · {current.task_title}
                </h2>
                <p className="mb-0 mt-1 text-xs capitalize text-cream-muted">
                  {current.space_name} · {phaseLabel(current.phase)}
                </p>
              </div>
              <span className="rounded-full border border-charcoal-border px-2 py-1 text-[10px] capitalize text-cream-muted">
                {current.state.replace(/_/g, " ")}
              </span>
            </div>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-charcoal-hover">
              <div
                className="h-full rounded-full bg-emerald-500 transition-[width]"
                style={{ width: `${Math.max(4, current.progress)}%` }}
              />
            </div>
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
              ) : canRetry(current) ? (
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
        {runDetail?.activity.length ? (
          <section>
            <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-cream-muted">
              Run activity
            </h2>
            <ol className="m-0 grid list-none gap-1.5 p-0">
              {runDetail.activity.map((item) => (
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
        {runDetail?.steps.length ? (
          <section>
            <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-cream-muted">
              Runtime steps
            </h2>
            <ol className="m-0 grid list-none gap-1.5 p-0">
              {runDetail.steps
                .slice(-12)
                .reverse()
                .map((step) => (
                  <li
                    key={step.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-charcoal-border bg-charcoal-sidebar px-3 py-2.5"
                  >
                    <span className="min-w-0 truncate text-xs text-cream">
                      {phaseLabel(step.node_id)}
                    </span>
                    <span className="shrink-0 text-[10px] capitalize text-cream-muted">
                      {step.state.replace(/_/g, " ")}
                    </span>
                  </li>
                ))}
            </ol>
          </section>
        ) : null}
      </div>
    </section>
  );
}
