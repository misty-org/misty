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
import { Button, ErrorNotification, IconButton, Pressable, Skeleton } from "@/shared/ui";
import { MistyMarkdown } from "../runs/markdown/MistyMarkdown";
import { deckPrompt, jobTitle, quizPrompt } from "./tutorPrompts";
import { startJob } from "./tutorRuns";
import { useTutorStore } from "./tutorStore";
import type { Guide } from "./tutorTypes";
import type { TutorActions } from "./TutorPage";
import { ShareToSpace } from "./ShareToSpace";
import { shareGuide } from "./tutorShare";
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
  const [error, setError] = useState("");
  const remove = async () => {
    if (!(await confirmAction(`Delete “${guide.title}”? This can’t be undone.`))) return;
    useTutorStore.getState().removeGuide(guide.id);
    onClose();
  };
  return (
    <>
      <div className="tutor-lead">
        <IconButton label="Back to the studio" onClick={onClose}>
          <ArrowLeft size={16} />
        </IconButton>
        <span className="tutor-actions">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void fromGuide(guide, "deck", actions.agentId);
              onClose();
            }}
          >
            <Layers size={15} />
            Flashcards
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void fromGuide(guide, "quiz", actions.agentId);
              onClose();
            }}
          >
            <ListChecks size={15} />
            Quiz me
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => actions.onLearn(`Teach me “${guide.title}”, step by step.`)}
          >
            Teach me
          </Button>
          {guide.conversationId ? (
            <IconButton
              label="Open the chat that wrote it"
              onClick={() => actions.onChat(actions.agentId, guide.conversationId!)}
            >
              <MessageSquare size={15} />
            </IconButton>
          ) : null}
          <ShareToSpace
            shared={guide.sharedNote}
            onShare={(spaceId) => shareGuide(guide.id, spaceId)}
            onError={setError}
          />
          <IconButton label="Delete guide" onClick={() => void remove()}>
            <Trash2 size={15} />
          </IconButton>
        </span>
      </div>
      <ErrorNotification message={error} onDismiss={() => setError("")} />
      <article className="tutor-guide">
        <MistyMarkdown>{guide.body}</MistyMarkdown>
      </article>
    </>
  );
}

/** Every question at once; Check marks them and keeps the score. */
export function QuizView({ quiz, onClose }: { quiz: Guide; onClose(): void }) {
  const [error, setError] = useState("");
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
        <IconButton label="Back to the studio" onClick={onClose}>
          <ArrowLeft size={16} />
        </IconButton>
        <span className="tutor-card-title">{quiz.title}</span>
        <span className="tutor-actions">
          {checked ? (
            <span className="tutor-card-detail" role="status">
              {score} of {questions.length} right
            </span>
          ) : null}
          <ShareToSpace
            shared={quiz.sharedNote}
            onShare={(spaceId) => shareGuide(quiz.id, spaceId)}
            onError={setError}
          />
          <IconButton label="Delete quiz" onClick={() => void remove()}>
            <Trash2 size={15} />
          </IconButton>
        </span>
      </div>
      <ErrorNotification message={error} onDismiss={() => setError("")} />
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
            size="sm"
            variant="outline"
            onClick={() => {
              setPicked({});
              setChecked(false);
            }}
          >
            Try again
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={Object.keys(picked).length < questions.length}
            onClick={check}
          >
            Check answers
          </Button>
        )}
      </div>
    </>
  );
}

/**
 * An audio overview: its sound, spoken on this computer's speech key, over the script it reads.
 * Without a speech model the script is still there, and the audio can be made once one is chosen.
 */
export function OverviewView({ overview, onClose }: { overview: Guide; onClose(): void }) {
  const [error, setError] = useState("");
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
        <IconButton label="Back to the studio" onClick={onClose}>
          <ArrowLeft size={16} />
        </IconButton>
        <span className="tutor-card-title">{overview.title}</span>
        <span className="tutor-actions">
          <Button
            variant="ghost"
            size="sm"
            disabled={overview.audio?.state === "making"}
            onClick={() => void makeOverviewAudio(overview.id)}
          >
            <RotateCcw size={15} />
            {ready ? "Speak again" : "Make audio"}
          </Button>
          <ShareToSpace
            shared={overview.sharedNote}
            onShare={(spaceId) => shareGuide(overview.id, spaceId)}
            onError={setError}
          />
          <IconButton label="Delete overview" onClick={() => void remove()}>
            <Trash2 size={15} />
          </IconButton>
        </span>
      </div>
      <ErrorNotification
        message={error || (overview.audio?.state === "failed" ? (overview.audio.error ?? "") : "")}
        onDismiss={() => setError("")}
      />
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
