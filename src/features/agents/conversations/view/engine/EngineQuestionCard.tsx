import { useState, type KeyboardEvent } from "react";
import type { EngineQuestion } from "../../../runs/invocations/invocation_types";
import { Button, ChoiceList, Input, QuestionPanel, Text } from "@misty/ui";
import { answerEngineQuestion, type EngineAnswers } from "./engine_api";
import type { EngineAsk } from "./engine_turn_store";

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

  const single = ask.questions.length === 1 ? ask.questions[0] : undefined;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (closed || !single || (event.target as HTMLElement).closest("input")) return;
    const number = Number(event.key);
    if (number >= 1 && number <= Math.min(single.options.length, 9)) {
      event.preventDefault();
      pick(single, single.options[number - 1]!.label);
    }
  };
  const [first, ...rest] = ask.questions;
  const answers = (question: EngineQuestion) => {
    const choice = choices[question.question];
    return (
      <>
        {question.options.length ? (
          <ChoiceList
            label={question.question}
            multiple={question.multiSelect}
            options={question.options}
            selected={choice?.picked ?? []}
            onSelect={(label) => pick(question, label)}
            shortcuts={question === single}
            disabled={closed}
          />
        ) : null}
        <Input
          aria-label={`Your own answer: ${question.question}`}
          placeholder={question.options.length ? "Something else" : "Your answer"}
          value={choice?.own ?? ""}
          disabled={closed}
          onChange={(event) => write(question, event.target.value)}
        />
      </>
    );
  };
  if (!first) return null;
  return (
    <QuestionPanel
      label="Question"
      title={
        <Text wrap size="control" tone="bright" weight="medium">
          {first.question}
        </Text>
      }
      aside={first.header || undefined}
      error={error}
      onKeyDown={onKeyDown}
      actions={
        closed ? (
          <Text size="meta" tone="muted">
            {sent === "skipped"
              ? "Skipped"
              : sent === "answered"
                ? "Answered"
                : "No longer waiting"}
          </Text>
        ) : (
          <>
            <Button
              variant="primary"
              disabled={!answered || sending}
              onClick={() => void send(false)}
            >
              Answer
            </Button>
            <Button variant="quiet" disabled={sending} onClick={() => void send(true)}>
              Skip
            </Button>
          </>
        )
      }
    >
      {answers(first)}
      {rest.map((question) => (
        <div key={question.question} className="grid min-w-0 gap-2 pt-2">
          <Text wrap size="control" tone="bright" weight="medium">
            {question.question}
          </Text>
          {answers(question)}
        </div>
      ))}
    </QuestionPanel>
  );
}
