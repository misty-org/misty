import { ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Skeleton, Pressable } from "@/shared/ui";
import { useProjectFolder } from "../context-panel/FolderPicker";
import { activityApi, type RunRow } from "./activityApi";
import { RunSteps } from "./RunSteps";
import { RunStateBadge, runWhen } from "./RunLabels";
import { useRunEvents, useRunSteps } from "./useRunSteps";

/** This chat's runs on this computer, newest first, kept current while one goes on. */
export function useChatRuns(conversationId: string): RunRow[] | null {
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [round, setRound] = useState(0);
  const reload = useMemo(() => () => setRound((value) => value + 1), []);
  useEffect(() => {
    let live = true;
    void activityApi
      .timeline([conversationId], 50)
      .then((rows) => live && setRuns(rows))
      .catch(() => live && setRuns((known) => known ?? []));
    return () => {
      live = false;
    };
  }, [conversationId, round]);
  useRunEvents(null, reload);
  return runs;
}

/**
 * The context panel's "Steps": what this chat's agent did in each run, step by step in plain
 * sentences, beside the chat's own tool rows. The latest run is open; earlier ones open on demand.
 */
export function StepsPanel({ conversationId }: { conversationId: string }) {
  const runs = useChatRuns(conversationId);
  const { folder } = useProjectFolder();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const latest = runs?.[0]?.runId ?? "";
  const shown = useMemo(
    () =>
      (runs ?? [])
        .filter((run) => run.runId === latest || open.has(run.runId))
        .map((run) => run.runId),
    [runs, latest, open],
  );
  const steps = useRunSteps(shown);

  if (!runs) {
    return (
      <div className="grid gap-2 p-3" aria-hidden="true">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-4 w-36" />
      </div>
    );
  }
  if (!runs.length) {
    return (
      <p className="activity-empty p-4">Each step the agent takes shows here, as it happens.</p>
    );
  }
  const now = Date.now();
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      {runs.map((run) => {
        const expanded = run.runId === latest || open.has(run.runId);
        return (
          <section key={run.runId} className="activity-panel-run">
            {run.runId === latest ? (
              <div className="activity-panel-head">
                <span className="activity-panel-when">{runWhen(run.startedAt, now)}</span>
                <RunStateBadge state={run.state} />
              </div>
            ) : (
              <Pressable
                type="button"
                className="activity-panel-head"
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
                <ChevronRight size={14} aria-hidden="true" className="activity-panel-chevron" />
                <span className="activity-panel-when">{runWhen(run.startedAt, now)}</span>
                <RunStateBadge state={run.state} />
              </Pressable>
            )}
            {expanded ? (
              steps?.[run.runId] ? (
                <RunSteps
                  runId={run.runId}
                  steps={steps[run.runId]!}
                  startedAt={run.startedAt}
                  folder={folder}
                  pictures
                />
              ) : (
                <div className="grid gap-2 px-2.5 py-2" aria-hidden="true">
                  <Skeleton className="h-3.5 w-3/5" />
                  <Skeleton className="h-3.5 w-1/2" />
                </div>
              )
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
