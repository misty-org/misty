import { useState } from "react";
import {
  AudioLines,
  CircleHelp,
  Clapperboard,
  FileText,
  GraduationCap,
  ImageIcon,
  Layers,
  Network,
  PanelRightClose,
  PanelRightOpen,
  Presentation,
  RotateCcw,
  Table2,
  X,
  type LucideIcon,
} from "lucide-react";
import { IconButton, OverflowFadeText, Pressable } from "@/shared/ui";
import { shortAgo } from "../../page/useChatStatuses";
import { useMistyStore } from "../../conversations/state/useMistyStore";
import { DeckView, ReviewSession } from "../TutorDecks";
import { GuideView, OverviewView, QuizView } from "../TutorGuides";
import type { TutorActions } from "../TutorPage";
import {
  deckPrompt,
  jobTitle,
  notebookContext,
  overviewPrompt,
  quizPrompt,
  teachPrompt,
} from "../tutorPrompts";
import { dismissJob, retryJob, startJob, startRun } from "../tutorRuns";
import {
  infographicPrompt,
  mindmapPrompt,
  reportPrompt,
  reports,
  slidesPrompt,
  videoPrompt,
} from "../tutorStudio";
import { useTutorStore } from "../tutorStore";
import type { Deck, Guide, Notebook, TutorJob, TutorJobKind } from "../tutorTypes";
import { MindMapView, SlidesView } from "./StudioViews";
import { InfographicView, VideoView } from "./VideoView";

type Tile = {
  id: string;
  label: string;
  icon: LucideIcon;
};

const tiles: Tile[] = [
  { id: "overview", label: "Audio overview", icon: AudioLines },
  { id: "video", label: "Video overview", icon: Clapperboard },
  { id: "mindmap", label: "Mind map", icon: Network },
  { id: "reports", label: "Reports", icon: FileText },
  { id: "deck", label: "Flashcards", icon: Layers },
  { id: "quiz", label: "Quiz", icon: CircleHelp },
  { id: "slides", label: "Slides", icon: Presentation },
  { id: "infographic", label: "Infographic", icon: ImageIcon },
  { id: "data-table", label: "Data table", icon: Table2 },
  { id: "teach", label: "Teach me", icon: GraduationCap },
];

function tileOf(kind: TutorJobKind | Guide["kind"] | "deck", report?: string): Tile {
  if (kind === "guide")
    return tiles.find((tile) => tile.id === (report === "data-table" ? "data-table" : "reports"))!;
  return tiles.find((tile) => tile.id === kind) ?? tiles[2];
}

type Output = { kind: "guide"; item: Guide } | { kind: "deck"; item: Deck };
type Viewing = { id: string; review?: boolean };

/**
 * The notebook's right panel, Create (NotebookLM's Studio): one tile per thing the person's agent
 * can make from the sources, what is being made, and what was made, which opens here in place.
 */
export function StudioPanel({
  notebook,
  actions,
  collapsed,
  viewing,
  onCollapse,
  onView,
  onError,
}: {
  notebook: Notebook;
  actions: TutorActions;
  collapsed: boolean;
  viewing?: Viewing;
  onCollapse(collapsed: boolean): void;
  onView(viewing?: Viewing): void;
  onError(message: string): void;
}) {
  const jobs = useTutorStore((state) => state.jobs);
  const guides = useTutorStore((state) => state.guides);
  const decks = useTutorStore((state) => state.decks);
  const [choosing, setChoosing] = useState(false);
  const fail = (reason: unknown) =>
    onError(reason instanceof Error ? reason.message : String(reason));
  const context = notebookContext(notebook);
  const topic = notebook.title;
  const made: Output[] = [
    ...Object.values(guides)
      .filter((guide) => guide.notebookId === notebook.id)
      .map((item) => ({ kind: "guide" as const, item })),
    ...Object.values(decks)
      .filter((deck) => deck.notebookId === notebook.id)
      .map((item) => ({ kind: "deck" as const, item })),
  ].sort((a, b) => b.item.createdAt.localeCompare(a.item.createdAt));
  const making = Object.values(jobs)
    .filter(
      (job) =>
        job.notebookId === notebook.id &&
        job.state !== "done" &&
        !["research", "brief", "summary", "note"].includes(job.kind),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const make = (kind: TutorJobKind, report?: string) => {
    const prompt =
      kind === "overview"
        ? overviewPrompt(topic, context)
        : kind === "mindmap"
          ? mindmapPrompt(topic, context)
          : kind === "deck"
            ? deckPrompt(topic, context)
            : kind === "quiz"
              ? quizPrompt(topic, context)
              : kind === "slides"
                ? slidesPrompt(topic, context)
                : kind === "video"
                  ? videoPrompt(topic, context)
                  : kind === "infographic"
                    ? infographicPrompt(topic, context)
                    : reportPrompt(report ?? "study-guide", topic, context);
    const title =
      kind === "guide"
        ? `${reports.find((item) => item.id === report)?.title ?? "Report"}: ${topic}`
        : jobTitle(kind, topic);
    void startJob({
      kind,
      title,
      agentId: actions.agentId,
      notebookId: notebook.id,
      report,
      prompt,
    }).catch(fail);
  };
  const press = (tile: Tile) => {
    if (tile.id === "reports") return setChoosing(!choosing);
    if (tile.id === "data-table") return make("guide", "data-table");
    if (tile.id === "teach")
      return void startRun({
        agentId: actions.agentId,
        title: notebook.title,
        prompt: teachPrompt(notebook.title, context),
        mode: "teach",
        background: false,
      })
        .then((run) => {
          if (run.error) return onError(run.error);
          if (!run.started) return onError("Another turn is working. Try again when it finishes.");
          actions.onChat(actions.agentId, run.conversationId);
        })
        .catch(fail);
    make(tile.id as TutorJobKind);
  };

  if (collapsed)
    return (
      <aside className="tutor-pane tutor-pane-rail" aria-label="Create">
        <IconButton label="Show Create" onClick={() => onCollapse(false)}>
          <PanelRightOpen />
        </IconButton>
        {tiles.map((tile) => (
          <IconButton key={tile.id} label={tile.label} onClick={() => press(tile)}>
            <tile.icon size={16} className="tutor-tile-icon" data-tint={tile.id} />
          </IconButton>
        ))}
      </aside>
    );

  const openDeck = viewing ? decks[viewing.id] : undefined;
  const open = viewing ? guides[viewing.id] : undefined;
  if (viewing && (open || openDeck)) {
    const close = () => onView(undefined);
    return (
      <aside className="tutor-pane tutor-studio-pane" data-viewing="true" aria-label="Create">
        <div className="tutor-pane-scroll tutor-studio-view">
          {openDeck ? (
            viewing.review ? (
              <ReviewSession decks={[openDeck]} onDone={() => onView({ id: openDeck.id })} />
            ) : (
              <DeckView
                deck={openDeck}
                onClose={close}
                onReview={() => onView({ id: openDeck.id, review: true })}
              />
            )
          ) : !open ? null : open.kind === "quiz" ? (
            <QuizView quiz={open} onClose={close} />
          ) : open.kind === "overview" ? (
            <OverviewView overview={open} onClose={close} />
          ) : open.kind === "mindmap" ? (
            <MindMapView map={open} onClose={close} />
          ) : open.kind === "slides" ? (
            <SlidesView deck={open} onClose={close} />
          ) : open.kind === "video" ? (
            <VideoView video={open} onClose={close} />
          ) : open.kind === "infographic" ? (
            <InfographicView infographic={open} onClose={close} />
          ) : (
            <GuideView guide={open} actions={actions} onClose={close} />
          )}
        </div>
      </aside>
    );
  }

  return (
    <aside className="tutor-pane tutor-studio-pane" aria-label="Create">
      <header className="tutor-pane-head">
        <h2>Create</h2>
        <IconButton label="Hide Create" onClick={() => onCollapse(true)}>
          <PanelRightClose />
        </IconButton>
      </header>
      <div className="tutor-pane-scroll">
        <div className="tutor-tiles">
          {tiles.map((tile) => (
            <Pressable
              key={tile.id}
              className="tutor-tile"
              aria-expanded={tile.id === "reports" ? choosing : undefined}
              data-tint={tile.id}
              onClick={() => press(tile)}
            >
              <tile.icon size={18} className="tutor-tile-icon" />
              <OverflowFadeText full>{tile.label}</OverflowFadeText>
            </Pressable>
          ))}
        </div>
        {choosing ? (
          <div className="tutor-report-choices" role="group" aria-label="Reports">
            <div className="tutor-pane-label-row">
              <span className="tutor-pane-label">Reports</span>
              <IconButton label="Close reports" size="sm" onClick={() => setChoosing(false)}>
                <X />
              </IconButton>
            </div>
            {reports
              .filter((report) => report.id !== "data-table")
              .map((report) => (
                <Pressable
                  key={report.id}
                  className="tutor-report-choice"
                  onClick={() => {
                    setChoosing(false);
                    make("guide", report.id);
                  }}
                >
                  {report.title}
                </Pressable>
              ))}
          </div>
        ) : null}

        <div className="tutor-outputs">
          {making.map((job) => (
            <JobOutput key={job.id} job={job} actions={actions} />
          ))}
          {made.map((output) => {
            const tile =
              output.kind === "deck"
                ? tileOf("deck")
                : tileOf(output.item.kind, output.item.report);
            const meta =
              output.kind === "deck"
                ? `${output.item.cards.length} cards`
                : output.item.kind === "guide"
                  ? (reports.find((item) => item.id === output.item.report)?.title ?? "Report")
                  : tile.label;
            return (
              <Pressable
                key={output.item.id}
                className="tutor-output"
                data-tint={tile.id}
                onClick={() => onView({ id: output.item.id })}
              >
                <tile.icon size={16} className="tutor-tile-icon" />
                <span className="tutor-output-text">
                  <OverflowFadeText full>{output.item.title}</OverflowFadeText>
                  <span className="tutor-card-detail">
                    {meta} · {shortAgo(output.item.createdAt)}
                  </span>
                </span>
              </Pressable>
            );
          })}
          {!made.length && !making.length ? (
            <div className="tutor-pane-empty">
              <Layers size={22} aria-hidden="true" />
              <p>What you create is saved here.</p>
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function JobOutput({ job, actions }: { job: TutorJob; actions: TutorActions }) {
  const tile = tileOf(job.kind, job.report);
  const failed = job.state === "failed";
  // A queued run whose chat already has its turn is starting, not waiting.
  const started = useMistyStore((state) =>
    state.conversations.some((chat) => chat.id === job.conversationId && chat.messages.length > 0),
  );
  return (
    <div className="tutor-output" data-tint={tile.id} data-state={job.state}>
      <tile.icon size={16} className="tutor-tile-icon" />
      <Pressable
        className="tutor-output-text"
        onClick={() => actions.onChat(job.agentId, job.conversationId)}
      >
        <OverflowFadeText className={failed ? undefined : "misty-shimmer"}>
          {job.title}
        </OverflowFadeText>
        <OverflowFadeText className="tutor-card-detail">
          {failed
            ? (job.error ?? "Failed")
            : job.state === "queued" && !started
              ? "Waiting for a turn to end"
              : "Making"}
        </OverflowFadeText>
      </Pressable>
      {failed ? (
        <>
          <IconButton label="Try again" size="sm" onClick={() => void retryJob(job)}>
            <RotateCcw />
          </IconButton>
          <IconButton label="Dismiss" size="sm" onClick={() => void dismissJob(job)}>
            <X />
          </IconButton>
        </>
      ) : null}
    </div>
  );
}
