import { MessageCircleQuestion } from "lucide-react";
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
    <div className="agent-answered-questions">
      {answered.map((set) => (
        <p key={set.id}>
          <MessageCircleQuestion size={13} aria-hidden="true" />
          <span className="agent-answered-label">You answered</span>
          {set.questions.map((question, index) => {
            const answer = set.answers?.[index];
            const parts = [...(answer?.selected ?? []), ...(answer?.other ? [answer.other] : [])];
            return (
              <span key={question.header + index} className="agent-answered-item">
                {question.header}: {parts.join("; ")}
              </span>
            );
          })}
        </p>
      ))}
    </div>
  );
}
