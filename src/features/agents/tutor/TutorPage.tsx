import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { StudioPage, StudioPageScroll } from "../methods/StudioPage";
import { useAgentAccountId } from "../personal/agentAccount";
import { useLessonStore } from "./lessons/lessonStore";
import { NotebookWorkspace } from "./notebook/NotebookWorkspace";
import { DeckView, ReviewSession } from "./TutorDecks";
import { GuideView, OverviewView, QuizView } from "./TutorGuides";
import { MindMapView, SlidesView } from "./notebook/StudioViews";
import { InfographicView, VideoView } from "./notebook/VideoView";
import { TutorHome } from "./TutorHome";
import { useTutorStore } from "./tutorStore";

/** What Tutor's pages need from the Agents page. */
export interface TutorActions {
  /** The agent Tutor's runs go to: the one the person last chose. */
  agentId: string;
  /** Opens a chat with an agent, such as a lesson's. */
  onChat(agentId: string, conversationId: string): void;
  /** Starts a Teach chat with this request in its composer. */
  onLearn(prompt: string): void;
  /** Goes to a place in Tutor: "" is its home, "notebook:<id>", "made:<id>" (something made
   * outside a notebook). */
  open(item: string): void;
}

/**
 * Tutor, a place to learn with agents. Its home lists the notebooks as cards after NotebookLM's,
 * with lessons below; a notebook has a bar with its name and settings
 * over three panes (sources, the conversation, the studio). Tutor's settings hold the cursor tutor.
 * There is no tab strip.
 */
export function TutorPage({
  agentId,
  onLesson,
  onLearn,
}: {
  agentId: string;
  onLesson(agentId: string, conversationId: string): void;
  onLearn(prompt: string): void;
}) {
  const accountId = useAgentAccountId();
  const [params, setParams] = useSearchParams();
  const item = params.get("item") ?? "";
  const notebooks = useTutorStore((state) => state.notebooks);
  const decks = useTutorStore((state) => state.decks);
  const guides = useTutorStore((state) => state.guides);
  useEffect(() => {
    void useLessonStore.getState().load(accountId);
    void useTutorStore.getState().load(accountId);
  }, [accountId]);

  const actions: TutorActions = useMemo(
    () => ({
      agentId,
      onChat: onLesson,
      onLearn,
      open(next) {
        setParams((current) => {
          const updated = new URLSearchParams(current);
          if (next) updated.set("item", next);
          else updated.delete("item");
          return updated;
        });
      },
    }),
    [agentId, onLesson, onLearn, setParams],
  );

  const notebook = item.startsWith("notebook:")
    ? notebooks[item.slice("notebook:".length)]
    : undefined;
  if (notebook)
    return (
      <StudioPage>
        <NotebookWorkspace key={notebook.id} notebook={notebook} actions={actions} />
      </StudioPage>
    );

  return (
    <StudioPage>
      <StudioPageScroll>
        {item.startsWith("made:") ? (
          <div className="mx-auto flex w-full max-w-220 flex-col gap-7 px-6 pt-7 pb-10">
            <Made id={item.slice("made:".length)} actions={actions} decks={decks} guides={guides} />
          </div>
        ) : (
          <TutorHome actions={actions} />
        )}
      </StudioPageScroll>
    </StudioPage>
  );
}

/** Something made outside a notebook, such as before notebooks held everything, on a page of its own. */
function Made({
  id,
  actions,
  decks,
  guides,
}: {
  id: string;
  actions: TutorActions;
  decks: ReturnType<typeof useTutorStore.getState>["decks"];
  guides: ReturnType<typeof useTutorStore.getState>["guides"];
}) {
  const home = () => actions.open("");
  const deck = decks[id.replace(/^review:/, "")];
  if (deck)
    return id.startsWith("review:") ? (
      <ReviewSession decks={[deck]} onDone={() => actions.open(`made:${deck.id}`)} />
    ) : (
      <DeckView
        deck={deck}
        onClose={home}
        onReview={() => actions.open(`made:review:${deck.id}`)}
      />
    );
  const guide = guides[id];
  if (!guide) return null;
  if (guide.kind === "quiz") return <QuizView quiz={guide} onClose={home} />;
  if (guide.kind === "overview") return <OverviewView overview={guide} onClose={home} />;
  if (guide.kind === "mindmap") return <MindMapView map={guide} onClose={home} />;
  if (guide.kind === "slides") return <SlidesView deck={guide} onClose={home} />;
  if (guide.kind === "video") return <VideoView video={guide} onClose={home} />;
  if (guide.kind === "infographic") return <InfographicView infographic={guide} onClose={home} />;
  return <GuideView guide={guide} actions={actions} onClose={home} />;
}
