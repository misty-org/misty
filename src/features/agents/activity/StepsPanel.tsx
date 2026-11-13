import { ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { useCachedResource } from "@/api/cache/cached-resource";
import { cn, Pressable, Text } from "@/shared/ui";
import { useProjectFolder } from "../context-panel/FolderPicker";
import { activityApi, type RunRow } from "./activityApi";
import { RunSteps, RunStepsEmpty } from "./RunSteps";
import { RunStateBadge, runWhen } from "./RunLabels";
import { StepRowsSkeleton, StepsSkeleton } from "./StepsSkeleton";
import { runStepsKey, useRunEvents } from "./useRunSteps";
import { useNow } from "@/shared/hooks/useNow";

/**
 * This chat's runs on this computer, newest first, kept current while one goes on. The runs read
 * before show at once and are read again behind them; null only on the very first read.
 */
function useChatRuns(conversationId: string): RunRow[] | null {
  const runs = useCachedResource(`agents/run-timeline:${conversationId}`, () =>
    activityApi.timeline([conversationId], 50),
  );
  useRunEvents(null, runs.reload);
  // A first read that failed shows the empty panel, not a skeleton that never ends.
  return runs.data ?? (runs.loading ? null : []);
}

/** One run's steps, from the last read while they are read again. */
function RunStepsBody(props: { run: RunRow; folder?: string }) {
  const { runId } = props.run;
  const steps = useCachedResource(runStepsKey(runId), () => activityApi.steps(runId));
  const runIds = useMemo(() => [runId], [runId]);
  useRunEvents(runIds, steps.reload);
  if (!steps.data && steps.loading) return <StepRowsSkeleton />;
  return (
    <RunSteps
      runId={runId}
      steps={steps.data ?? []}
      startedAt={props.run.startedAt}
      folder={props.folder}
      pictures
    />
  );
}

/** A run's head: when it started and its state, on a 30px line in the steps' inset. */
const headClass = "flex min-h-7.5 items-center gap-2 rounded-lg px-2.5";

/**
 * The context panel's "Steps": what this chat's agent did in each run, step by step in plain
 * sentences, beside the chat's own tool rows. The latest run is open; earlier ones open on demand.
 */
export function StepsPanel({ conversationId }: { conversationId: string }) {
  const runs = useChatRuns(conversationId);
  const { folder } = useProjectFolder();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const latest = runs?.[0]?.runId ?? "";

  if (!runs) return <StepsSkeleton />;
  if (!runs.length) {
    return <RunStepsEmpty>Each step the agent takes shows here, as it happens.</RunStepsEmpty>;
  }
  const now = useNow();
  return (
    <Text as="div" bare tone="default" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      {runs.map((run) => {
        const expanded = run.runId === latest || open.has(run.runId);
        return (
          <section key={run.runId} className="grid gap-1 pt-2">
            {run.runId === latest ? (
              <Text as="div" bare size="caption" weight="medium" className={headClass}>
                <span className="flex-1 text-left">{runWhen(run.startedAt, now)}</span>
                <RunStateBadge state={run.state} />
              </Text>
            ) : (
              <Pressable
                type="button"
                wash="control"
                className={cn(headClass, "text-caption font-medium")}
                aria-expanded={expanded}
                onClick={() =>
                  setOpen((current) => {
                    const next = new Set(current);
                    if (next.has(run.runId)) next.delete(run.runId);
                    else next.add(run.runId);
                    return next;
                  })
                }
              >
                <Text bare tone="muted" className="flex shrink-0">
                  <ChevronRight
                    aria-hidden="true"
                    className={cn(
                      "transition-transform duration-120 motion-reduce:transition-none",
                      expanded && "rotate-90",
                    )}
                  />
                </Text>
                <span className="flex-1 text-left">{runWhen(run.startedAt, now)}</span>
                <RunStateBadge state={run.state} />
              </Pressable>
            )}
            {expanded ? <RunStepsBody run={run} folder={folder} /> : null}
          </section>
        );
      })}
    </Text>
  );
}
