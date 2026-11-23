import { useEffect } from "react";
import { EnginePlanReview } from "./EnginePlanReview";
import { EngineQuestionCard } from "./EngineQuestionCard";
import {
  restoreEngineTurn,
  useEngineTurnStore,
  watchEngineTurns,
  type EngineTurn,
} from "./engine_turn_store";

export function useEngineTurn(runId: string | undefined, live: boolean): EngineTurn | undefined {
  const turn = useEngineTurnStore((state) => (runId ? state.byRun[runId] : undefined));
  useEffect(() => {
    if (!runId) return;
    watchEngineTurns();
    if (!live) void restoreEngineTurn(runId);
  }, [runId, live]);
  return turn;
}

export function EngineAsks(props: {
  runId: string;
  turn: EngineTurn;
  conversationId?: string;
  onSend?: (prompt: string) => void;
}) {
  const { turn } = props;
  const draft = turn.planDraft.trim() && !turn.ended;
  if (!turn.asks.length && !turn.plan && !draft) return null;
  return (
    <div className="my-3 grid gap-2.5">
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
      ) : draft ? (
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
    </div>
  );
}
