import { ArrowLeft, Check, NotebookPen, SquarePen, Users } from "lucide-react";
import { useState } from "react";
import {
  Button,
  citationChipsClass,
  cn,
  IconButton,
  Pressable,
  Surface,
  Text,
  Tooltip,
} from "@/shared/ui";
import { MistyMarkdown } from "../../runs/markdown/MistyMarkdown";
import { spacesGateway, type DocVisibility } from "../../spaces-gateway/spacesGateway";
import type { Turn } from "../notebookThread";
import { personTone } from "../personTone";
import { useTutorStore } from "../tutorStore";
import type { Notebook } from "../tutorTypes";
import { answerForNotes, citeLinks } from "./citations";
import { PersonAvatar } from "./LivePeople";

/**
 * The bar over a notebook's questions: teammates whose thread is shared (open one to watch it
 * live), and for the person's own thread its private/shared menu and a new conversation. While a
 * teammate's thread is open, the way back to the person's own.
 */
export function ThreadBar({
  notebook,
  shared,
  viewing,
  onView,
  visibility,
  onShare,
  onNew,
  hasTurns,
}: {
  notebook: Notebook;
  shared: { userId: string; docId: string }[];
  viewing?: { userId: string; docId: string };
  onView(thread?: { userId: string; docId: string }): void;
  visibility: DocVisibility;
  onShare(visibility: DocVisibility): void;
  onNew(): void;
  hasTurns: boolean;
}) {
  const gateway = spacesGateway.maybe();
  const spaceId = notebook.space?.spaceId;
  const nameOf = (userId: string) =>
    spaceId && gateway ? gateway.memberName(spaceId, userId) : "Someone";
  if (viewing)
    return (
      <div className="flex items-center gap-1.5">
        <Button variant="quiet" icon={ArrowLeft} onClick={() => onView(undefined)}>
          Your questions
        </Button>
        <Text bare size="caption" tone="muted" className="ml-auto">
          {nameOf(viewing.userId)}'s questions
        </Text>
      </div>
    );
  const Menu = gateway?.VisibilityMenu;
  if (!hasTurns && !shared.length) return null;
  return (
    <div className="flex items-center justify-end gap-0.5">
      {shared.length ? (
        <span className="mr-auto flex items-center gap-1">
          {shared.map((thread) => (
            <Tooltip key={thread.userId} content={`${nameOf(thread.userId)}'s questions`}>
              <Pressable
                className="inline-flex"
                aria-label={`${nameOf(thread.userId)}'s questions`}
                onClick={() => onView(thread)}
              >
                <PersonAvatar
                  spaceId={spaceId}
                  person={{
                    id: thread.userId,
                    name: nameOf(thread.userId),
                    tone: personTone(thread.userId),
                  }}
                />
              </Pressable>
            </Tooltip>
          ))}
        </span>
      ) : null}
      {hasTurns && Menu ? (
        <Menu label="Your questions" visibility={visibility} onChange={onShare} />
      ) : null}
      {hasTurns ? (
        <IconButton label="New conversation" onClick={onNew}>
          <SquarePen />
        </IconButton>
      ) : null}
    </div>
  );
}

/** A thread's turns: each question as asked, its answer as it's written, and what to do with it. */
export function ThreadTurns({
  notebook,
  turns,
  readOnly,
  offerNotes,
}: {
  notebook: Notebook;
  turns: readonly Turn[];
  /** A teammate's thread: watched, not added to. */
  readOnly?: boolean;
  /** Others are in the Space, so an answer can be shown to the team. */
  offerNotes: boolean;
}) {
  const [added, setAdded] = useState<Set<string>>(() => new Set());
  const addToNotes = (turn: Turn) => {
    const me = spacesGateway.maybe()?.me()?.userId;
    useTutorStore.getState().saveNote(notebook.id, {
      title: turn.question.trim().replace(/\s+/g, " ").slice(0, 80) || "Answer",
      body: answerForNotes(turn.answer, turn.cites, notebook.sources),
      origin: "agent",
      authorId: me,
      fromQuestion: turn.question,
    });
    setAdded((current) => new Set([...current, turn.id]));
  };
  return (
    <>
      {turns.map((turn) => {
        const working = turn.state === "asking" || turn.state === "answering";
        const done = turn.state === "done" && Boolean(turn.answer);
        const wasAdded =
          added.has(turn.id) ||
          notebook.notes.some(
            (item) => item.fromQuestion === turn.question && item.origin === "agent",
          );
        return (
          <div key={turn.id} className="flex flex-col gap-3.5">
            <Surface
              as="p"
              tone="well"
              radius="xl"
              className="max-w-[85%] self-end px-3 py-2 whitespace-pre-wrap"
            >
              <Text bare size="control" tone="bright">
                {turn.question}
              </Text>
            </Surface>
            <Text
              bare
              as="div"
              size="control"
              tone="default"
              className={cn("leading-[1.65]", citationChipsClass)}
            >
              {turn.answer ? (
                <MistyMarkdown>{citeLinks(turn.answer, turn.cites)}</MistyMarkdown>
              ) : null}
              {working && !turn.answer ? (
                <Text bare size="caption" tone="muted" className="flex-none misty-shimmer">
                  Reading the sources
                </Text>
              ) : null}
              {turn.state === "failed" ? (
                <Text bare size="caption" tone="muted" className="flex-none">
                  {turn.error || "This answer stopped before it finished."}
                </Text>
              ) : null}
              {done && !readOnly ? (
                <div className="mt-1.5 flex">
                  <Button
                    size="sm"
                    variant="quiet"
                    icon={wasAdded ? Check : offerNotes ? Users : NotebookPen}
                    onClick={() => (wasAdded ? undefined : addToNotes(turn))}
                  >
                    {wasAdded ? "In notes" : offerNotes ? "Show the team" : "Add to notes"}
                  </Button>
                </div>
              ) : null}
            </Text>
          </div>
        );
      })}
    </>
  );
}
