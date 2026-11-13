import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  Layers,
  ListChecks,
  MessageSquare,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { confirmAction } from "@/shared/lib/confirmAction";
import {
  Button,
  IconButton,
  Pressable,
  Skeleton,
  Surface,
  Text,
  useNotice,
  type SurfaceEdge,
  type TextTone,
} from "@/shared/ui";
import { MistyMarkdown } from "../runs/markdown/MistyMarkdown";
import { deckPrompt, jobTitle, quizPrompt } from "./tutorPrompts";
import { startJob } from "./tutorRuns";
import { useTutorStore } from "./tutorStore";
import type { Guide } from "./tutorTypes";
import type { TutorActions } from "./TutorPage";
import { deleteOverviewAudio, makeOverviewAudio, overviewAudioUrl } from "./tutorAudio";

/** Starts flashcards or a quiz from a guide's own text. */
function fromGuide(guide: Guide, kind: "deck" | "quiz", agentId: string) {
  const context = `The study guide “${guide.title}”:\n\n${guide.body}`;
  return startJob({
    kind,
    title: jobTitle(kind, guide.title),
    agentId,
    notebookId: guide.notebookId,
    prompt: kind === "deck" ? deckPrompt(guide.title, context) : quizPrompt(guide.title, context),
  });
}

export function GuideView({
  guide,
  actions,
  onClose,
}: {
  guide: Guide;
  actions: TutorActions;
  onClose(): void;
}) {
  const remove = async () => {
    if (!(await confirmAction(`Delete “${guide.title}”? This can’t be undone.`))) return;
    useTutorStore.getState().removeGuide(guide.id);
    onClose();
  };
  return (
    <>
      <div className="flex min-h-9 items-center justify-between gap-2">
        <IconButton label="Back to Create" onClick={onClose}>
          <ArrowLeft />
        </IconButton>
        <span className="ml-auto flex items-center gap-0.5">
          <Button
            variant="quiet"
            onClick={() => {
              void fromGuide(guide, "deck", actions.agentId);
              onClose();
            }}
            icon={Layers}
          >
            Flashcards
          </Button>
          <Button
            variant="quiet"
            onClick={() => {
              void fromGuide(guide, "quiz", actions.agentId);
              onClose();
            }}
            icon={ListChecks}
          >
            Quiz me
          </Button>
          <Button
            variant="quiet"
            onClick={() => actions.onLearn(`Teach me “${guide.title}”, step by step.`)}
          >
            Teach me
          </Button>
          {guide.conversationId ? (
            <IconButton
              label="Open the chat that wrote it"
              onClick={() => actions.onChat(actions.agentId, guide.conversationId!)}
            >
              <MessageSquare />
            </IconButton>
          ) : null}
          <IconButton label="Delete guide" onClick={() => void remove()}>
            <Trash2 />
          </IconButton>
        </span>
      </div>
      <Text bare as="div" size="control" tone="default" className="max-w-190 leading-[1.7]">
        <article>
          <MistyMarkdown>{guide.body}</MistyMarkdown>
        </article>
      </Text>
    </>
  );
}

/** A choice's edge: its verdict once checked, stronger while it is the one picked. */
function choiceEdge(verdict: "right" | "wrong" | undefined, chosen: boolean): SurfaceEdge {
  if (verdict) return verdict;
  return chosen ? "strong" : "hairline";
}

/** Right and wrong carry meaning, so they get color; the picked choice is brighter. */
function choiceTone(verdict: "right" | "wrong" | undefined, chosen: boolean): TextTone {
  if (verdict) return verdict === "right" ? "done" : "failed";
  return chosen ? "bright" : "default";
}

/** Every question at once; Check marks them and keeps the score. */
export function QuizView({ quiz, onClose }: { quiz: Guide; onClose(): void }) {
  const questions = quiz.questions ?? [];
  const [picked, setPicked] = useState<Record<number, number>>({});
  const [checked, setChecked] = useState(false);
  const score = questions.filter((q, index) => picked[index] === q.answer).length;
  const check = () => {
    setChecked(true);
    useTutorStore
      .getState()
      .saveGuide({ ...quiz, lastScore: score, updatedAt: new Date().toISOString() });
  };
  const remove = async () => {
    if (!(await confirmAction(`Delete “${quiz.title}”? This can’t be undone.`))) return;
    useTutorStore.getState().removeGuide(quiz.id);
    onClose();
  };
  return (
    <>
      <div className="flex min-h-9 items-center justify-between gap-2">
        <IconButton label="Back to Create" onClick={onClose}>
          <ArrowLeft />
        </IconButton>
        <Text size="control" tone="bright">
          {quiz.title}
        </Text>
        <span className="ml-auto flex items-center gap-0.5">
          {checked ? (
            <Text bare size="caption" tone="muted" className="flex-none" role="status">
              {score} of {questions.length} right
            </Text>
          ) : null}
          <IconButton label="Delete quiz" onClick={() => void remove()}>
            <Trash2 />
          </IconButton>
        </span>
      </div>
      <ol className="flex flex-col gap-5.5 pl-5">
        {questions.map((question, index) => (
          // The item's own tone is its number's; what is in it takes its own.
          <Text bare as="li" tone="muted" key={index}>
            <Text as="p" size="control" tone="bright" wrap className="mb-2">
              {question.question}
            </Text>
            <div
              className="mb-1.5 flex flex-col gap-1.5"
              role="radiogroup"
              aria-label={question.question}
            >
              {question.choices.map((choice, choiceIndex) => {
                const chosen = picked[index] === choiceIndex;
                const verdict = !checked
                  ? undefined
                  : choiceIndex === question.answer
                    ? "right"
                    : chosen
                      ? "wrong"
                      : undefined;
                return (
                  <Surface
                    key={choiceIndex}
                    tone="none"
                    edge={choiceEdge(verdict, chosen)}
                    radius="lg"
                    className="overflow-hidden"
                  >
                    <Pressable
                      role="radio"
                      aria-checked={chosen}
                      wash="control"
                      data-selected={chosen || undefined}
                      data-verdict={verdict}
                      disabled={checked}
                      className="flex w-full px-3 py-2"
                      onClick={() => setPicked((current) => ({ ...current, [index]: choiceIndex }))}
                    >
                      <Text
                        bare
                        size="meta"
                        tone={choiceTone(verdict, chosen)}
                        className="flex min-w-0 flex-1 items-center justify-between gap-2.5"
                      >
                        <span className="truncate-none">{choice}</span>
                        {verdict === "right" ? <Check /> : null}
                        {verdict === "wrong" ? <X /> : null}
                      </Text>
                    </Pressable>
                  </Surface>
                );
              })}
            </div>
            {checked && question.explanation ? (
              <Text as="p" size="caption" tone="muted" wrap>
                {question.explanation}
              </Text>
            ) : null}
          </Text>
        ))}
      </ol>
      <div className="flex min-h-9 items-center justify-between gap-2">
        {checked ? (
          <Button
            onClick={() => {
              setPicked({});
              setChecked(false);
            }}
          >
            Try again
          </Button>
        ) : (
          <Button disabled={Object.keys(picked).length < questions.length} onClick={check}>
            Check answers
          </Button>
        )}
      </div>
    </>
  );
}

/**
 * An audio overview: its sound, spoken on this computer's speech key or its own voices, over the
 * script it reads. When no voice can read it, the script is still there, and the audio can be made again.
 */
export function OverviewView({ overview, onClose }: { overview: Guide; onClose(): void }) {
  const [error, setError] = useState("");
  const shownError =
    error || (overview.audio?.state === "failed" ? (overview.audio.error ?? "") : "");
  useNotice(Boolean(shownError), {
    message: shownError,
    tone: "error",
    onDismiss: () => setError(""),
  });
  const [url, setUrl] = useState<string>();
  const ready = overview.audio?.state === "ready";
  useEffect(() => {
    if (!ready) return;
    let made: string | undefined;
    let live = true;
    overviewAudioUrl(overview.id)
      .then((next) => {
        made = next;
        if (live) setUrl(next);
        else URL.revokeObjectURL(next);
      })
      .catch((reason: unknown) => setError(String(reason)));
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
      setUrl(undefined);
    };
  }, [overview.id, ready, overview.audio?.seconds]);
  const remove = async () => {
    if (!(await confirmAction(`Delete “${overview.title}”? This can’t be undone.`))) return;
    void deleteOverviewAudio(overview.id);
    useTutorStore.getState().removeGuide(overview.id);
    onClose();
  };
  return (
    <>
      <div className="flex min-h-9 items-center justify-between gap-2">
        <IconButton label="Back to Create" onClick={onClose}>
          <ArrowLeft />
        </IconButton>
        <Text size="control" tone="bright">
          {overview.title}
        </Text>
        <span className="ml-auto flex items-center gap-0.5">
          <Button
            variant="quiet"
            disabled={overview.audio?.state === "making"}
            onClick={() => void makeOverviewAudio(overview.id)}
            icon={RotateCcw}
          >
            {ready ? "Speak again" : "Make audio"}
          </Button>
          <IconButton label="Delete overview" onClick={() => void remove()}>
            <Trash2 />
          </IconButton>
        </span>
      </div>
      <Surface
        tone="card"
        edge="hairline"
        radius="xl"
        className="flex min-h-12 items-center px-3 py-2"
      >
        {overview.audio?.state === "making" ? (
          <Text bare size="caption" tone="muted" className="misty-shimmer">
            Speaking the script
          </Text>
        ) : url ? (
          <audio controls src={url} className="w-full" />
        ) : ready ? (
          <Skeleton className="h-10 w-full rounded-lg" />
        ) : (
          <Text bare size="caption" tone="muted">
            No audio yet
          </Text>
        )}
      </Surface>
      <Text
        bare
        as="div"
        size="control"
        tone="default"
        className="flex max-w-190 flex-col gap-2.5 leading-[1.6]"
      >
        {(overview.script ?? []).map((line, index) => (
          <p
            key={index}
            data-speaker={line.speaker}
            className="grid grid-cols-[calc(var(--spacing)*5.5)_minmax(0,1fr)] gap-2"
          >
            <Text bare size="caption" weight="semibold" tone="muted" className="leading-[1.9]">
              {line.speaker === 0 ? "A" : "B"}
            </Text>
            <span>{line.text}</span>
          </p>
        ))}
      </Text>
    </>
  );
}
