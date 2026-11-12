import { useState } from "react";
import type { EngineQuestion } from "../../../runs/invocations/invocationTypes";
import { Button, Input, Pressable, cn } from "@/shared/ui";
import { answerEngineQuestion, type EngineAnswers } from "./engineApi";
import type { EngineAsk } from "./engineTurnStore";

type Choice = { picked: string[]; own: string };

function answerOf(question: EngineQuestion, choice: Choice | undefined): string | string[] | null {
  const own = choice?.own.trim() ?? "";
  const picked = choice?.picked ?? [];
  if (question.multiSelect) {
    const all = own ? [...picked, own] : picked;
    return all.length ? all : null;
  }
  return own || picked[0] || null;
}

/**
 * A question an outside engine asks the person (Claude's AskUserQuestion, Codex's
 * `requestUserInput`, an ACP form): its options, several when it allows that, and the person's
 * own words. The turn waits until it is answered or skipped.
 */
export function EngineQuestionCard({ runId, ask }: { runId: string; ask: EngineAsk }) {
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<"answered" | "skipped">();
  const [error, setError] = useState("");
  const answered = ask.questions.every((question) =>
    answerOf(question, choices[question.question]),
  );
  const closed = ask.settled || Boolean(sent);

  const pick = (question: EngineQuestion, label: string) =>
    setChoices((current) => {
      const choice = current[question.question] ?? { picked: [], own: "" };
      const picked = question.multiSelect
        ? choice.picked.includes(label)
          ? choice.picked.filter((item) => item !== label)
          : [...choice.picked, label]
        : [label];
      return {
        ...current,
        [question.question]: { picked, own: question.multiSelect ? choice.own : "" },
      };
    });
  const write = (question: EngineQuestion, own: string) =>
    setChoices((current) => {
      const choice = current[question.question] ?? { picked: [], own: "" };
      return {
        ...current,
        [question.question]: { picked: question.multiSelect ? choice.picked : [], own },
      };
    });

  const send = async (skip: boolean) => {
    setSending(true);
    setError("");
    const answers: EngineAnswers = {};
    for (const question of ask.questions) {
      const answer = answerOf(question, choices[question.question]);
      if (answer) answers[question.question] = answer;
    }
    try {
      await answerEngineQuestion(runId, ask.requestId, skip ? null : answers);
      setSent(skip ? "skipped" : "answered");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="engine-question" data-closed={closed || undefined} aria-label="Question">
      {ask.questions.map((question) => {
        const choice = choices[question.question];
        return (
          <fieldset key={question.question} className="engine-question-item" disabled={closed}>
            <legend className="engine-question-text">
              {question.header ? (
                <span className="engine-question-header">{question.header}</span>
              ) : null}
              {question.question}
            </legend>
            {question.options.length ? (
              <div
                className="engine-question-options"
                role={question.multiSelect ? "group" : "radiogroup"}
              >
                {question.options.map((option) => {
                  const on = choice?.picked.includes(option.label) ?? false;
                  return (
                    <Pressable
                      key={option.label}
                      type="button"
                      role={question.multiSelect ? "checkbox" : "radio"}
                      aria-checked={on}
                      className={cn("engine-question-option", on && "engine-question-option-on")}
                      onClick={() => pick(question, option.label)}
                    >
                      <span>{option.label}</span>
                      {option.description ? (
                        <span className="engine-question-option-description">
                          {option.description}
                        </span>
                      ) : null}
                    </Pressable>
                  );
                })}
              </div>
            ) : null}
            <Input
              aria-label={`Your own answer: ${question.question}`}
              placeholder={question.options.length ? "Something else" : "Your answer"}
              value={choice?.own ?? ""}
              onChange={(event) => write(question, event.target.value)}
            />
          </fieldset>
        );
      })}
      {closed ? (
        <p className="engine-question-closed">
          {sent === "skipped" ? "Skipped" : sent === "answered" ? "Answered" : "No longer waiting"}
        </p>
      ) : (
        <div className="engine-question-actions">
          <Button
            size="sm"
            variant="primary"
            disabled={!answered || sending}
            onClick={() => void send(false)}
          >
            Send answer
          </Button>
          <Button size="sm" variant="ghost" disabled={sending} onClick={() => void send(true)}>
            Skip
          </Button>
        </div>
      )}
      {error ? (
        <p className="engine-question-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
