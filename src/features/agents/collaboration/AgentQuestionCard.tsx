import { Check, ChevronDown, ChevronUp, MessageCircleQuestion } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button, IconButton, Input, Pressable } from "@/shared/ui";
import { useCollaborationStore } from "./store";
import type { AgentQuestionAnswer, AgentQuestionSet } from "./types";
import "./collaboration.css";

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
      <div className="agent-question-strip">
        <MessageCircleQuestion size={14} aria-hidden="true" />
        <span>
          {questions.length === 1 ? "1 question" : `${questions.length} questions`} from {agentName}{" "}
          waiting
        </span>
        <Button variant="ghost" size="sm" onClick={() => setCollapsed(false)}>
          <ChevronUp aria-hidden="true" />
          Answer
        </Button>
      </div>
    );
  return (
    <div
      ref={card}
      className="agent-question-card"
      role="group"
      aria-label={`${agentName} is asking`}
      onKeyDown={onKeyDown}
    >
      <div className="agent-question-head">
        <span className="agent-question-chip">{question.header}</span>
        <span className="agent-question-count" aria-live="polite">
          {questions.length > 1 ? `${index + 1} of ${questions.length}` : `${agentName} is asking`}
        </span>
        <IconButton size="xs" label="Collapse questions" onClick={() => setCollapsed(true)}>
          <ChevronDown />
        </IconButton>
      </div>
      <p className="agent-question-text">{question.question}</p>
      <div
        className="agent-question-options"
        role={question.multiSelect ? "group" : "radiogroup"}
        aria-label={question.question}
      >
        {question.options.map((option, optionIndex) => {
          const selected = answer.selected.includes(option.label);
          return (
            <Pressable
              key={option.label}
              role={question.multiSelect ? "checkbox" : "radio"}
              aria-checked={selected}
              className="agent-question-option"
              onClick={() => choose(option.label)}
            >
              <span className="agent-question-key" aria-hidden="true">
                {optionIndex + 1}
              </span>
              <span className="agent-question-label">
                <span>{option.label}</span>
                {option.description && <small>{option.description}</small>}
              </span>
              <Check className="agent-question-check" aria-hidden="true" />
            </Pressable>
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
      {error && (
        <p role="alert" className="agent-question-error">
          {error}
        </p>
      )}
      <div className="agent-question-actions">
        <span className="agent-question-hint">
          {question.multiSelect ? "Choose any that apply" : "Choose one"} · Esc to hide
        </span>
        {index > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setIndex(index - 1)}>
            Back
          </Button>
        )}
        <Button
          variant={last ? "primary" : "outline"}
          size="sm"
          disabled={busy || !answered(answer) || (last && !answers.every(answered))}
          onClick={advance}
        >
          {last ? (busy ? "Sending…" : "Submit") : "Next"}
        </Button>
      </div>
    </div>
  );
}
