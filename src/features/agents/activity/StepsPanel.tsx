import { useMemo, useState } from "react";
import { useCachedResource } from "@/api/cache/cached_resource";
import { Button, cn, ErrorState, FoldChevron, Pressable, Text, rowShapeWrap } from "@misty/ui";
import { useChatFolder } from "../shared-folders/chat_folder";
import { activityApi, type RunRow } from "./activity_api";
import { RunSteps, RunStepsEmpty } from "./RunSteps";
import { RunStateBadge, runWhen } from "./RunLabels";
import { StepRowsSkeleton, StepsSkeleton } from "./StepsSkeleton";
import { runStepsKey, useRunEvents } from "./use_run_steps";
import { useNow } from "@/shared/hooks/use_now";
import { openBrowserLog } from "../browser-log/browser_log_store";
import { chatKey } from "../conversations/state/draft_chat";

function useChatRuns(conversationId: string) {
  const runs = useCachedResource(`agents/run-timeline:${conversationId}`, () =>
    activityApi.timeline([conversationId], 50),
  );
  useRunEvents(null, runs.reload);
  return {
    runs: runs.data ?? null,
    failed: !runs.data && !runs.loading,
    retry: () => void runs.reload(),
  };
}

function RunStepsBody(props: { run: RunRow; folder?: string; conversationId: string }) {
  const { runId } = props.run;
  const steps = useCachedResource(runStepsKey(runId), () => activityApi.steps(runId));
  const runIds = useMemo(() => [runId], [runId]);
  useRunEvents(runIds, steps.reload);
  if (!steps.data && steps.loading) return <StepRowsSkeleton />;
  if (!steps.data)
    return (
      <div role="alert" className="flex min-w-0 items-center gap-2 px-2.5 py-1.5">
        <Text wrap size="meta" tone="removed" className="min-w-0 flex-1">
          This run's steps couldn't be read.
        </Text>
        <Button size="sm" variant="secondary" onClick={() => void steps.reload()}>
          Try again
        </Button>
      </div>
    );
  return (
    <RunSteps
      runId={runId}
      steps={steps.data}
      startedAt={props.run.startedAt}
      folder={props.folder}
      pictures
      onOpenBrowserLog={(callId) => openBrowserLog(chatKey(props.conversationId), runId, callId)}
    />
  );
}

const headClass = rowShapeWrap;

export function StepsPanel({ conversationId }: { conversationId: string }) {
  const { runs, failed, retry } = useChatRuns(conversationId);
  const { folder } = useChatFolder(conversationId);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const latest = runs?.[0]?.runId ?? "";
  const now = useNow();

  if (failed)
    return (
      <ErrorState
        title="Couldn't read this chat's steps"
        line="Something went wrong on this computer. Try again in a moment."
        action={{ label: "Try again", onClick: retry }}
      />
    );
  if (!runs) return <StepsSkeleton />;
  if (!runs.length) {
    return <RunStepsEmpty>Each step the agent takes shows here, as it happens.</RunStepsEmpty>;
  }
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
                  <FoldChevron open={expanded} />
                </Text>
                <span className="flex-1 text-left">{runWhen(run.startedAt, now)}</span>
                <RunStateBadge state={run.state} />
              </Pressable>
            )}
            {expanded ? (
              <RunStepsBody run={run} folder={folder} conversationId={conversationId} />
            ) : null}
          </section>
        );
      })}
    </Text>
  );
}
