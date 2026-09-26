import type { SpaceRoadmapSnapshot } from "@/api/spaces/dto/interfaces/plannerExpansionTypes";
import { Button, cn } from "@/shared/ui";
import {
  ArrowRight,
  CalendarClock,
  Check,
  CircleDot,
  ListChecks,
  LockKeyhole,
  PanelRightClose,
} from "lucide-react";
import { useMemo } from "react";
import { buildRoadmapExecutionPlan, type RoadmapExecutionItem } from "./roadmapExecutionPlan";

export function RoadmapExecutionRail(props: {
  snapshot: SpaceRoadmapSnapshot;
  selectedId: string;
  onClose?: () => void;
  onFocus: (id: string) => void;
  onOpenTask: (taskId: string) => void;
}) {
  const plan = useMemo(() => buildRoadmapExecutionPlan(props.snapshot), [props.snapshot]);
  const completion = plan.totalCount ? Math.round((plan.doneCount / plan.totalCount) * 100) : 0;

  return (
    <aside
      className="flex h-full w-[288px] shrink-0 flex-col overflow-hidden border-l border-charcoal-border/70 bg-charcoal-bg"
      aria-label="Daily roadmap plan"
    >
      <header className="border-b border-charcoal-border/60 px-4 pb-3 pt-4">
        <div className="flex items-center gap-2">
          <ListChecks className="size-4 text-sage-fg" />
          <h2 className="text-sm font-semibold text-cream">Daily plan</h2>
          {props.onClose ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="ml-auto size-7"
              aria-label="Hide daily plan"
              onClick={props.onClose}
            >
              <PanelRightClose className="size-4" />
            </Button>
          ) : null}
        </div>
        <div className="mt-3 flex items-center gap-3 text-[11px] text-cream-muted">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-charcoal-card">
            <div
              className="h-full rounded-full bg-sage-fg transition-[width] duration-300"
              style={{ width: `${completion}%` }}
            />
          </div>
          <span className="tabular-nums">
            {plan.doneCount}/{plan.totalCount} done
          </span>
        </div>
      </header>

      <div className="misty-transient-scrollbar min-h-0 flex-1 overflow-y-auto">
        {plan.next ? (
          <section className="border-b border-charcoal-border/60 p-3">
            <div className="rounded-xl bg-charcoal-card px-3 py-3">
              <div className="flex items-center gap-2 text-[11px] font-medium text-sage-fg">
                <CircleDot className="size-3.5" />
                Next up
                <span className="ml-auto tabular-nums text-cream-muted">{plan.next.progress}%</span>
              </div>
              <button
                type="button"
                className="mt-2 block w-full text-left text-sm font-semibold leading-5 text-cream outline-none hover:text-cream-bright focus-visible:underline"
                onClick={() => props.onFocus(plan.next!.id)}
              >
                {plan.next.title}
              </button>
              {plan.next.nextTask ? (
                <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-cream-muted">
                  Start with {plan.next.nextTask.title}
                </p>
              ) : (
                <p className="mt-1 text-[11px] leading-4 text-cream-muted">
                  Define the first task to begin this goal.
                </p>
              )}
              <Button
                type="button"
                size="sm"
                className="mt-3 h-8 w-full justify-between px-3 text-xs"
                onClick={() =>
                  plan.next?.nextTask
                    ? props.onOpenTask(plan.next.nextTask.id)
                    : props.onFocus(plan.next!.id)
                }
              >
                {plan.next.nextTask ? "Open next task" : "Open goal"}
                <ArrowRight className="size-3.5" />
              </Button>
            </div>
          </section>
        ) : (
          <section className="border-b border-charcoal-border/60 px-4 py-5">
            <p className="text-sm font-medium text-cream">
              {plan.totalCount && plan.doneCount === plan.totalCount
                ? "Everything is complete"
                : "No goal is ready yet"}
            </p>
            <p className="mt-1 text-[11px] leading-4 text-cream-muted">
              {plan.totalCount && plan.doneCount === plan.totalCount
                ? "This roadmap has reached its outcome."
                : "Resolve a blocker or update a dependency to continue."}
            </p>
          </section>
        )}

        <nav className="px-3 py-3" aria-label="Roadmap execution order">
          <div className="mb-2 flex items-center justify-between px-1">
            <h3 className="text-xs font-semibold text-cream">Execution path</h3>
            <span className="text-[10px] tabular-nums text-cream-muted">
              {plan.readyCount} ready · {plan.blockedCount} blocked
            </span>
          </div>
          <ol className="relative space-y-0.5 before:absolute before:bottom-4 before:left-[19px] before:top-4 before:w-px before:bg-charcoal-border">
            {plan.items.map((item) => (
              <ExecutionRow
                key={item.id}
                item={item}
                selected={props.selectedId === item.id}
                onFocus={() => props.onFocus(item.id)}
              />
            ))}
          </ol>
        </nav>
      </div>
    </aside>
  );
}

function ExecutionRow(props: {
  item: RoadmapExecutionItem;
  selected: boolean;
  onFocus: () => void;
}) {
  const { item } = props;
  const stateLabel = item.state === "done" ? "Done" : item.state === "ready" ? "Ready" : "Blocked";
  return (
    <li className="relative">
      <button
        type="button"
        className={cn(
          "group flex w-full items-start gap-2.5 rounded-lg px-2 py-2.5 text-left outline-none transition-colors",
          "hover:bg-charcoal-card focus-visible:bg-charcoal-card focus-visible:ring-1 focus-visible:ring-sage-fg/50",
          props.selected && "bg-charcoal-card",
        )}
        onClick={props.onFocus}
      >
        <span
          className={cn(
            "relative z-10 grid size-6 shrink-0 place-items-center rounded-full border bg-charcoal-bg text-[10px] font-semibold tabular-nums",
            item.state === "done" && "border-sage-fg/50 text-sage-fg",
            item.state === "ready" && "border-cream/40 text-cream",
            item.state === "blocked" && "border-charcoal-border text-cream-muted",
          )}
        >
          {item.state === "done" ? (
            <Check className="size-3.5" />
          ) : item.state === "blocked" ? (
            <LockKeyhole className="size-3" />
          ) : (
            item.sequence
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-cream">{item.title}</span>
          <span className="mt-0.5 block truncate text-[10px] text-cream-muted">
            {item.state === "blocked"
              ? `Waiting on ${item.blockerTitles.join(", ")}`
              : `${stateLabel} · ${item.remainingTasks} task${item.remainingTasks === 1 ? "" : "s"} left`}
          </span>
          {item.targetDate ? (
            <span className="mt-1 flex items-center gap-1 text-[10px] text-cream-muted">
              <CalendarClock className="size-3" />
              {formatCompactDate(item.targetDate)}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

function formatCompactDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}
