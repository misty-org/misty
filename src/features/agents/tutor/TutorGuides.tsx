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
import { Button, IconButton, Pressable, Skeleton, useNotice, OverflowFadeText } from "@/shared/ui";
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
      <div className="tutor-lead">
        <IconButton label="Back to Create" onClick={onClose}>
          <ArrowLeft />
        </IconButton>
        <span className="tutor-actions">
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
      <article className="tutor-guide">
        <MistyMarkdown>{guide.body}</MistyMarkdown>
      </article>
    </>
  );
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
      <div className="tutor-lead">
        <IconButton label="Back to Create" onClick={onClose}>
          <ArrowLeft />
        </IconButton>
        <OverflowFadeText className="tutor-card-title">{quiz.title}</OverflowFadeText>
        <span className="tutor-actions">
          {checked ? (
            <span className="tutor-card-detail" role="status">
              {score} of {questions.length} right
            </span>
          ) : null}
          <IconButton label="Delete quiz" onClick={() => void remove()}>
            <Trash2 />
          </IconButton>
        </span>
      </div>
      <ol className="tutor-quiz">
        {questions.map((question, index) => (
          <li key={index}>
            <p className="tutor-quiz-question">{question.question}</p>
            <div className="tutor-quiz-choices" role="radiogroup" aria-label={question.question}>
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
                  <Pressable
                    key={choiceIndex}
                    role="radio"
                    aria-checked={chosen}
                    className="tutor-quiz-choice"
                    data-verdict={verdict}
                    disabled={checked}
                    onClick={() => setPicked((current) => ({ ...current, [index]: choiceIndex }))}
                  >
                    <span className="truncate-none">{choice}</span>
                    {verdict === "right" ? <Check size={14} /> : null}
                    {verdict === "wrong" ? <X size={14} /> : null}
                  </Pressable>
                );
              })}
            </div>
            {checked && question.explanation ? (
              <p className="tutor-card-detail">{question.explanation}</p>
            ) : null}
          </li>
        ))}
      </ol>
      <div className="tutor-lead">
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
      <div className="tutor-lead">
        <IconButton label="Back to Create" onClick={onClose}>
          <ArrowLeft />
        </IconButton>
        <OverflowFadeText className="tutor-card-title">{overview.title}</OverflowFadeText>
        <span className="tutor-actions">
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
      <div className="tutor-player">
        {overview.audio?.state === "making" ? (
          <span className="tutor-card-detail misty-shimmer">Speaking the script</span>
        ) : url ? (
          <audio controls src={url} className="w-full" />
        ) : ready ? (
          <Skeleton className="h-10 w-full rounded-lg" />
        ) : (
          <span className="tutor-card-detail">No audio yet</span>
        )}
      </div>
      <div className="tutor-script">
        {(overview.script ?? []).map((line, index) => (
          <p key={index} data-speaker={line.speaker}>
            <span className="tutor-script-speaker">{line.speaker === 0 ? "A" : "B"}</span>
            <span>{line.text}</span>
          </p>
        ))}
      </div>
    </>
  );
}
