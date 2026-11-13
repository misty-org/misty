import { useState } from "react";
import { Button } from "@/shared/ui";
import { ErrorNotice } from "../conversations/ErrorNotice";
import {
  actionQuestionHasDetails,
  actionQuestionText,
  actionQuestionVerb,
  answerActionQuestion,
  useActionQuestions,
} from "./actionQuestions";
import { usePersonalAgentsStore } from "../personal/personalAgentsStore";
import { StatusRow, StatusTable } from "../progress/StatusTable";

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
                <Button
                  variant="primary"
                  disabled={closed}
                  onClick={() => answer(question.id, true)}
                >
                  Accept and continue
                </Button>
                {question.rememberable && question.origin ? (
                  <Button disabled={closed} onClick={() => answer(question.id, true, true)}>
                    Accept and remember
                  </Button>
                ) : null}
                <Button disabled={closed} onClick={() => answer(question.id, false)}>
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
                    ? `Remember: ${actionQuestionVerb(question)} on ${question.origin}. ` +
                      "Applies when the chat is in Auto."
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
            >
              {actionQuestionText(question, name)}
              {actionQuestionHasDetails(question) ? (
                <span
                  className="mt-1.5 block max-h-64 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere]"
                  tabIndex={0}
                >
                  {question.control}
                </span>
              ) : null}
            </StatusRow>
          </StatusTable>
        );
      })}
      <ErrorNotice message={error} onDismiss={() => setError("")} />
    </div>
  );
}
