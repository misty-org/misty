import { useState } from "react";
import { Button } from "@/shared/ui";
import {
  actionQuestionText,
  actionQuestionVerb,
  answerActionQuestion,
  useActionQuestions,
} from "./actionQuestions";
import { usePersonalAgentsStore } from "./personalAgentsStore";
import { StatusRow, StatusTable } from "./progress/StatusTable";

/**
 * Questions from agents about to pay, send, delete or post, in the control
 * island. Nothing happens until the person allows it; no answer in three
 * minutes means no.
 */
export function AgentActionQuestions() {
  const questions = useActionQuestions((state) => state.items);
  const agents = usePersonalAgentsStore((state) => state.agents);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  if (!questions.length) return null;
  const answer = (id: string, allow: boolean, remember = false) => {
    setBusy(id);
    setError("");
    void answerActionQuestion(id, allow, remember)
      .catch(() =>
        setError(
          remember
            ? "Misty couldn’t remember that approval, so nothing was done. Try again."
            : "That question already closed. Nothing was done.",
        ),
      )
      .finally(() => setBusy(""));
  };
  return (
    <div className="grid gap-1" role="group" aria-label="Agent needs your OK">
      {questions.map((question) => {
        const name = agents.find((agent) => agent.id === question.agentId)?.name ?? "Your agent";
        const closed = busy === question.id;
        return (
          <StatusTable
            key={question.id}
            label={`${name} needs your OK`}
            actions={
              <>
                <Button size="sm" variant="primary" disabled={closed} onClick={() => answer(question.id, true)}>
                  Accept and continue
                </Button>
                {question.rememberable && question.origin ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={closed}
                    onClick={() => answer(question.id, true, true)}
                  >
                    Accept and remember
                  </Button>
                ) : null}
                <Button size="sm" variant="outline" disabled={closed} onClick={() => answer(question.id, false)}>
                  Deny
                </Button>
              </>
            }
          >
            <StatusRow
              state="waiting"
              verb="Waiting for you"
              sub={
                [
                  question.reason,
                  question.rememberable && question.origin
                    ? `Remember: ${actionQuestionVerb(question)} on ${question.origin}. Applies when the chat is in Auto.`
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
            >
              {actionQuestionText(question, name)}
            </StatusRow>
          </StatusTable>
        );
      })}
      {error ? (
        <p className="m-0 px-1 text-xs text-cream-muted" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
