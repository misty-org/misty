import { useState } from "react";
import type { EngineQuestion } from "../../../runs/invocations/invocationTypes";
import { Button, Input, Pressable, Surface, Text } from "@/shared/ui";
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
    <Surface
      as="section"
      tone="card"
      edge="hairline"
      radius="xl"
      className="grid gap-3 px-4 py-3.5 data-closed:opacity-70"
      data-closed={closed || undefined}
      aria-label="Question"
    >
      {ask.questions.map((question) => {
        const choice = choices[question.question];
        return (
          <fieldset
            key={question.question}
            className="m-0 grid min-w-0 gap-2 border-0 p-0"
            disabled={closed}
          >
            <Text bare as="legend" size="control" tone="default" className="p-0 leading-normal">
              {question.header ? (
                <Surface
                  as="span"
                  tone="active"
                  radius="sm"
                  className="mr-2 inline-block px-2 py-px"
                >
                  <Text bare size="caption" tone="muted">
                    {question.header}
                  </Text>
                </Surface>
              ) : null}
              {question.question}
            </Text>
            {question.options.length ? (
              <Text
                bare
                as="div"
                size="meta"
                tone="default"
                className="grid gap-1.5"
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
                      wash="control"
                      selected={on}
                      className="rounded-lg"
                      onClick={() => pick(question, option.label)}
                    >
                      <Surface
                        as="span"
                        tone="none"
                        edge={on ? "bright" : "hairline"}
                        radius="lg"
                        className="grid gap-0.5 px-3 py-2"
                      >
                        <span>{option.label}</span>
                        {option.description ? (
                          <Text bare size="caption" tone="muted">
                            {option.description}
                          </Text>
                        ) : null}
                      </Surface>
                    </Pressable>
                  );
                })}
              </Text>
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
        <Text wrap size="meta" tone="muted" className="m-0">
          {sent === "skipped" ? "Skipped" : sent === "answered" ? "Answered" : "No longer waiting"}
        </Text>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={!answered || sending}
            onClick={() => void send(false)}
          >
            Send answer
          </Button>
          <Button variant="quiet" disabled={sending} onClick={() => void send(true)}>
            Skip
          </Button>
        </div>
      )}
      {error ? (
        <Text wrap size="meta" tone="danger" className="m-0" role="alert">
          {error}
        </Text>
      ) : null}
    </Surface>
  );
}
