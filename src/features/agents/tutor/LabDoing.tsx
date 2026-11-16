import { useEffect, type ReactNode } from "react";
import { useNow } from "@/shared/hooks/useNow";
import { activityWords, lastActivity } from "./notebook/NotebookPeople";
import { hold, release, useOthersMaking } from "./notebookLive";
import { useTutorStore } from "./tutorStore";

const nouns: Record<string, string> = {
  guide: "a report",
  quiz: "a quiz",
  overview: "an audio overview",
  mindmap: "a mind map",
  slides: "a slide deck",
  infographic: "an infographic",
  video: "a video overview",
  deck: "flashcards",
};

/**
 * What a member is doing in the Lab notebook they have open, in a few words for the Space's home:
 * "Sam is making a quiz", or the last thing they added. Holds the notebook's room while shown, so
 * it's live; says nothing for a notebook this computer hasn't seen.
 */
export function LabDoing({
  userId,
  name,
  docId,
  before,
}: {
  userId: string;
  name: string;
  docId: string;
  /** Shown ahead of the words, only when there are some (a separator). */
  before?: ReactNode;
}) {
  const now = useNow();
  const notebook = useTutorStore((state) =>
    Object.values(state.notebooks).find((item) => item.space?.docId === docId),
  );
  const notebookId = notebook?.id;
  useEffect(() => {
    if (!notebookId) return;
    let kept = false;
    let gone = false;
    void hold(notebookId).then((found) => {
      kept = Boolean(found);
      if (gone && kept) release(notebookId);
    });
    return () => {
      gone = true;
      if (kept) release(notebookId);
    };
  }, [notebookId]);
  const making = useOthersMaking(notebookId ?? "").find((item) => item.by === userId);
  const decks = useTutorStore((state) => state.decks);
  const guides = useTutorStore((state) => state.guides);
  if (!notebook) return null;
  if (making)
    return (
      <>
        {before}
        {`${making.agent ? `${name}'s ${making.agent.name}` : name} is making ${nouns[making.kind] ?? "something"}`}
      </>
    );
  const outputs = [...Object.values(decks), ...Object.values(guides)].filter(
    (item) => item.notebookId === notebook.id,
  );
  const last = lastActivity(notebook, outputs, undefined, now, userId);
  return last ? (
    <>
      {before}
      {activityWords(last.done.agent ? `${name}'s ${last.done.agent.name}` : name, last)}
    </>
  ) : null;
}
