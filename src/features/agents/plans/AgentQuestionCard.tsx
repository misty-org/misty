import { ChevronDown, ChevronUp, MessageCircleQuestion } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  BackButton,
  Button,
  ChoiceList,
  IconButton,
  Input,
  QuestionPanel,
  Surface,
  Text,
} from "@misty/ui";
import { useCollaborationStore } from "./store";
import type { AgentQuestionAnswer, AgentQuestionSet } from "./plan_types";

const blank = (): AgentQuestionAnswer => ({ selected: [], other: "" });

export function AgentQuestionCard({
  questionSet,
  agentName,
  onContinue,
}: {
  questionSet: AgentQuestionSet;
  agentName: string;
  onContinue(prompt: string): void;
}) {
  const questions = questionSet.questions;
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<AgentQuestionAnswer[]>(() => questions.map(blank));
  const [collapsed, setCollapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const card = useRef<HTMLDivElement>(null);
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
      <Surface tone="faint" radius="xl" className="mb-2 flex items-center gap-2 py-1 pr-1 pl-3">
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
  const count = questions.length > 1 ? `${index + 1} of ${questions.length}` : "";
  const aside = [question.header, count].filter(Boolean).join(", ");
  return (
    <QuestionPanel
      panelRef={card}
      label={`${agentName} is asking`}
      title={
        <Text wrap size="control" tone="bright" weight="medium">
          {question.question}
        </Text>
      }
      aside={aside || undefined}
      end={
        <IconButton label="Hide questions" onClick={() => setCollapsed(true)}>
          <ChevronDown />
        </IconButton>
      }
      error={error}
      onKeyDown={onKeyDown}
      actions={
        <>
          {index > 0 && <BackButton onClick={() => setIndex(index - 1)} />}
          <Button
            variant={last ? "primary" : "secondary"}
            disabled={!answered(answer) || (last && !answers.every(answered)) || busy}
            onClick={advance}
          >
            {last ? "Answer" : "Next"}
          </Button>
        </>
      }
    >
      <ChoiceList
        label={question.question}
        multiple={question.multiSelect}
        options={question.options}
        selected={answer.selected}
        onSelect={choose}
        shortcuts
      />
      <Input
        aria-label="Other answer"
        placeholder="Something else"
        value={answer.other ?? ""}
        maxLength={1000}
        onChange={(event) => update({ ...answer, other: event.target.value })}
      />
    </QuestionPanel>
  );
}
