import { useState } from "react";
import { Button } from "@/shared/ui";
import { actionQuestionText, answerActionQuestion, useActionQuestions } from "./actionQuestions";
import { usePersonalAgentsStore } from "./personalAgentsStore";

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
  const answer = (id: string, allow: boolean) => {
    setBusy(id);
    setError("");
    void answerActionQuestion(id, allow)
      .catch(() => setError("That question already closed. Nothing was done."))
      .finally(() => setBusy(""));
  };
  return (
    <div className="grid gap-2" role="group" aria-label="Agent needs your OK">
      {questions.map((question) => {
        const name = agents.find((agent) => agent.id === question.agentId)?.name ?? "Your agent";
        return (
          <div
            key={question.id}
            role="alertdialog"
            aria-label={`${name} needs your OK`}
            className="grid gap-2 rounded-xl border border-charcoal-border bg-charcoal-bg p-2"
          >
            <p className="m-0 px-1 text-sm text-cream-bright">
              {actionQuestionText(question, name)}
            </p>
            {question.reason ? (
              <p className="m-0 px-1 text-xs text-cream-muted">{question.reason}</p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy === question.id}
                onClick={() => answer(question.id, false)}
              >
                Don’t allow
              </Button>
              <Button
                size="sm"
                disabled={busy === question.id}
                onClick={() => answer(question.id, true)}
              >
                Allow once
              </Button>
            </div>
          </div>
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
