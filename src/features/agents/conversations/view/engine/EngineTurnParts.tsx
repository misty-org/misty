import { useEffect } from "react";
import { EnginePlanReview } from "./EnginePlanReview";
import { EngineQuestionCard } from "./EngineQuestionCard";
import { EngineSubagents } from "./EngineSubagents";
import { EngineThinking } from "./EngineThinking";
import { EngineTodos } from "./EngineTodos";
import { restoreEngineTurn, useEngineTurnStore, watchEngineTurns } from "./engineTurnStore";
import "./engineTurn.css";

/**
 * What an outside engine's turn shows beyond Misty's own progress: its reasoning, its todo list,
 * its sub-agents, the questions it asks, the plan it wants reviewed, and a status line for
 * compaction, retries and the model that answered.
 */
export function EngineTurnParts(props: {
  runId: string;
  live: boolean;
  conversationId?: string;
  onSend?: (prompt: string) => void;
}) {
  const turn = useEngineTurnStore((state) => state.byRun[props.runId]);
  useEffect(() => {
    watchEngineTurns();
    if (!props.live) void restoreEngineTurn(props.runId);
  }, [props.runId, props.live]);
  if (!turn) return null;
  const status = turn.ended
    ? ""
    : turn.compacting
      ? "Compacting the conversation"
      : turn.retry
        ? `Retrying ${turn.retry.attempt}${turn.retry.max ? ` of ${turn.retry.max}` : ""}`
        : turn.background
          ? `Waiting for ${turn.background} background ${turn.background === 1 ? "task" : "tasks"}`
          : "";
  return (
    <div className="engine-turn">
      <EngineThinking text={turn.thinking} answering={turn.answering || turn.ended} />
      <EngineTodos todos={turn.todos} live={props.live} />
      <EngineSubagents subagents={turn.subagents} />
      {turn.asks.map((ask) => (
        <EngineQuestionCard key={ask.requestId} runId={props.runId} ask={ask} />
      ))}
      {turn.plan ? (
        <EnginePlanReview
          key={`${turn.plan.planId}:${turn.plan.revision}`}
          plan={turn.plan}
          conversationId={props.conversationId}
          onSend={props.onSend}
        />
      ) : turn.planDraft.trim() && !turn.ended ? (
        <EnginePlanReview
          draft
          plan={{
            planId: "draft",
            revision: 0,
            engine: "",
            sessionId: "",
            title: "Plan",
            content: turn.planDraft,
            complete: false,
            reviewKind: "next_turn",
            status: "draft",
          }}
        />
      ) : null}
      {status ? (
        <p className="engine-turn-status" title={turn.retry?.message || undefined}>
          {status}
        </p>
      ) : null}
      {turn.ended && turn.model ? (
        <p className="engine-turn-model">
          {turn.model}
          {turn.effort ? ` · ${turn.effort}` : ""}
        </p>
      ) : null}
    </div>
  );
}
