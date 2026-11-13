import { Check, ChevronDown, ChevronUp, MessageCircleQuestion } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { BackButton, Button, cn, IconButton, Input, Pressable, Surface, Text } from "@/shared/ui";
import { ErrorNotice } from "../conversations/ErrorNotice";
import { useCollaborationStore } from "./store";
import type { AgentQuestionAnswer, AgentQuestionSet } from "./planTypes";

const blank = (): AgentQuestionAnswer => ({ selected: [], other: "" });

/**
 * Questions the agent is waiting on, above the composer: one at a time, options
 * as rows with a checkmark, an Other field, then Submit. Number keys pick,
 * Enter advances, Esc collapses to a strip. Typing a message instead answers
 * by superseding the questions.
 */
export function AgentQuestionCard({
  questionSet,
  agentName,
  onContinue,
}: {
  questionSet: AgentQuestionSet;
  agentName: string;
  /** Sends the turn that carries answers given after the run handed off. */
  onContinue(prompt: string): void;
}) {
  const questions = questionSet.questions;
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<AgentQuestionAnswer[]>(() => questions.map(blank));
  const [collapsed, setCollapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const card = useRef<HTMLDivElement>(null);
  // Only a new question set starts over; refreshed copies of the same set keep
  // the answers in progress.
  useEffect(() => {
    setIndex(0);
    setAnswers(questionSet.questions.map(blank));
    setCollapsed(false);
    setError("");
  }, [questionSet.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const question = questions[index];
  const answer = answers[index] ?? blank();
  const answered = (value: AgentQuestionAnswer) =>
    value.selected.length > 0 || Boolean(value.other?.trim());
  const last = index === questions.length - 1;
  const update = (next: AgentQuestionAnswer) =>
    setAnswers((current) => current.map((value, i) => (i === index ? next : value)));
  const choose = (label: string) => {
    if (!question) return;
    const selected = answer.selected.includes(label)
      ? answer.selected.filter((value) => value !== label)
      : question.multiSelect
        ? [...answer.selected, label]
        : [label];
    update({ ...answer, selected });
  };
  const submit = async () => {
    if (busy || !answers.every(answered)) return;
    setBusy(true);
    setError("");
    try {
      const prompt = await useCollaborationStore.getState().answer(questionSet, answers);
      if (prompt) onContinue(prompt);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Misty couldn't save your answers. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const advance = () => {
    if (!answered(answer)) return;
    if (last) void submit();
    else setIndex(index + 1);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const typing = (event.target as HTMLElement).closest("input");
    if (event.key === "Escape") {
      event.preventDefault();
      setCollapsed(true);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      advance();
      return;
    }
    const number = Number(event.key);
    if (!typing && question && number >= 1 && number <= question.options.length) {
      event.preventDefault();
      choose(question.options[number - 1]!.label);
    }
  };
  if (!question) return null;
  if (collapsed)
    return (
      <Surface
        tone="card"
        edge="hairline"
        radius="xl"
        className="mb-2 flex items-center gap-2 py-1 pr-1 pl-3"
      >
        <Text bare size="meta" tone="muted" className="flex min-w-0 flex-1 items-center gap-2">
          <MessageCircleQuestion aria-hidden="true" />
          <span className="min-w-0 flex-1">
            {questions.length === 1 ? "1 question" : `${questions.length} questions`} from{" "}
            {agentName} waiting
          </span>
        </Text>
        <Button variant="quiet" onClick={() => setCollapsed(false)}>
          <ChevronUp aria-hidden="true" />
          Answer
        </Button>
      </Surface>
    );
  return (
    <Surface
      ref={card}
      tone="card"
      edge="hairline"
      radius="xl"
      className="mb-2 grid gap-2.5 px-3 pt-3 pb-2.5"
      role="group"
      aria-label={`${agentName} is asking`}
      onKeyDown={onKeyDown}
    >
      <div className="flex items-center gap-2">
        <QuestionChip>{question.header}</QuestionChip>
        <Text bare size="caption" tone="muted" className="flex-1" aria-live="polite">
          {questions.length > 1 ? `${index + 1} of ${questions.length}` : `${agentName} is asking`}
        </Text>
        <IconButton label="Collapse questions" onClick={() => setCollapsed(true)}>
          <ChevronDown />
        </IconButton>
      </div>
      <QuestionText>{question.question}</QuestionText>
      <div
        className="grid gap-1"
        role={question.multiSelect ? "group" : "radiogroup"}
        aria-label={question.question}
      >
        {question.options.map((option, optionIndex) => {
          const selected = answer.selected.includes(option.label);
          return (
            <Surface
              as={Pressable}
              key={option.label}
              role={question.multiSelect ? "checkbox" : "radio"}
              aria-checked={selected}
              tone={selected ? "active" : "none"}
              radius="md"
              wash={selected ? undefined : "control"}
              className={cn(
                "grid w-full cursor-pointer grid-cols-[--spacing(5)_minmax(0,1fr)_--spacing(4)] items-start gap-2",
                "border border-transparent px-2.5 py-2 text-left text-meta leading-[1.4] font-normal whitespace-normal",
              )}
              onClick={() => choose(option.label)}
            >
              <Surface
                as="span"
                tone="none"
                edge="hairline"
                radius="sm"
                className="grid size-4.5 place-items-center text-micro tabular-nums"
                aria-hidden="true"
              >
                <Text bare tone="muted">
                  {optionIndex + 1}
                </Text>
              </Surface>
              <Text bare tone={selected ? "bright" : "default"} className="grid min-w-0 gap-0.5">
                <span>{option.label}</span>
                {option.description && (
                  <Text as="small" bare size="caption" tone="muted" className="leading-[1.4]">
                    {option.description}
                  </Text>
                )}
              </Text>
              <Check
                className={cn("mt-0.5", selected ? "opacity-100" : "opacity-0")}
                aria-hidden="true"
              />
            </Surface>
          );
        })}
        <Input
          aria-label="Other answer"
          placeholder="Other…"
          value={answer.other ?? ""}
          maxLength={1000}
          onChange={(event) => update({ ...answer, other: event.target.value })}
        />
      </div>
      <ErrorNotice message={error} onDismiss={() => setError("")} />
      <div className="flex items-center gap-1.5">
        <QuestionHint>
          {question.multiSelect ? "Choose any that apply" : "Choose one"} · Esc to hide
        </QuestionHint>
        {index > 0 && <BackButton onClick={() => setIndex(index - 1)} />}
        <Button
          variant={last ? "primary" : "secondary"}
          disabled={!answered(answer) || (last && !answers.every(answered))}
          loading={busy}
          onClick={advance}
        >
          {last ? "Submit" : "Next"}
        </Button>
      </div>
    </Surface>
  );
}

/** The question's short header, or what the card is about, in a hairline chip. */
export function QuestionChip({ children }: { children: ReactNode }) {
  return (
    <Surface as="span" tone="none" edge="hairline" radius="md" className="px-2 py-0.5 text-caption">
      <Text bare tone="default">
        {children}
      </Text>
    </Surface>
  );
}

/** What is asked, in the person's words. */
export function QuestionText({ children }: { children: ReactNode }) {
  return (
    <Text as="p" wrap size="control" tone="bright" className="m-0 leading-normal">
      {children}
    </Text>
  );
}

/** The quiet line before the card's buttons, taking the room they leave. */
export function QuestionHint({ children }: { children: ReactNode }) {
  return (
    <Text bare size="caption" tone="muted" className="flex-1">
      {children}
    </Text>
  );
}
