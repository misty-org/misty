import { StatusRow, StatusTable } from "../progress/StatusTable";
import { useCollaborationStore } from "./store";
import type { AgentQuestionSet } from "./types";
import "./collaboration.css";

const noSets: AgentQuestionSet[] = [];

/**
 * Questions a run asked and got answered while it waited, shown read-only with
 * that run's answer. Answers given after a hand-off are their own user turn.
 */
export function AgentAnsweredQuestions({
  conversationId,
  invocationId,
}: {
  conversationId: string;
  invocationId?: string;
}) {
  const sets = useCollaborationStore(
    (s) => s.byConversation[conversationId]?.questionSets ?? noSets,
  );
  if (!invocationId) return null;
  const answered = sets.filter(
    (set) => set.runId === invocationId && set.state === "answered" && !set.handedOff,
  );
  if (!answered.length) return null;
  return (
    <>
      {answered.map((set) => (
        <StatusTable key={set.id} label="You answered">
          {set.questions.map((question, index) => {
            const answer = set.answers?.[index];
            const parts = [...(answer?.selected ?? []), ...(answer?.other ? [answer.other] : [])];
            return (
              <StatusRow
                key={question.header + index}
                state="done"
                verb="You answered"
                meta={parts.join("; ")}
              >
                {question.header}
              </StatusRow>
            );
          })}
        </StatusTable>
      ))}
    </>
  );
}
