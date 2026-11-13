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
import {
  EmptyState,
  IconButton,
  OverflowFadeText,
  Pressable,
  Surface,
  Text,
  type Tint,
} from "@/shared/ui";
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
import { paneClass, paneHeadClass, paneScrollClass, railClass } from "./panes";
import { MindMapView, SlidesView } from "./StudioViews";
import { InfographicView, VideoView } from "./VideoView";
import { useNow } from "@/shared/hooks/useNow";

type Tile = {
  id: string;
  label: string;
  icon: LucideIcon;
  /** The color of what it makes, on its tile and on everything it made. */
  tint: Tint;
};

const tiles: Tile[] = [
  { id: "overview", label: "Audio overview", icon: AudioLines, tint: "audio" },
  { id: "video", label: "Video overview", icon: Clapperboard, tint: "video" },
  { id: "mindmap", label: "Mind map", icon: Network, tint: "map" },
  { id: "reports", label: "Reports", icon: FileText, tint: "report" },
  { id: "deck", label: "Flashcards", icon: Layers, tint: "cards" },
  { id: "quiz", label: "Quiz", icon: CircleHelp, tint: "quiz" },
  { id: "slides", label: "Slides", icon: Presentation, tint: "slides" },
  { id: "infographic", label: "Infographic", icon: ImageIcon, tint: "infographic" },
  { id: "data-table", label: "Data table", icon: Table2, tint: "table" },
  { id: "teach", label: "Teach me", icon: GraduationCap, tint: "lesson" },
];

/** A made thing in the list under the tiles, washed under the pointer. */
const outputClass = "flex items-center gap-2.5 px-2.5 py-2 text-left";
/** A made thing's name over its detail line. */
const outputTextClass = "flex min-w-0 flex-1 flex-col gap-0.5 text-left";

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
  const now = useNow();
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
      <Surface
        as="aside"
        tone="none"
        edge="hairline"
        className={`${railClass} border-0 border-l`}
        aria-label="Create"
      >
        <IconButton label="Show Create" onClick={() => onCollapse(false)}>
          <PanelRightOpen />
        </IconButton>
        {tiles.map((tile) => (
          <IconButton key={tile.id} label={tile.label} onClick={() => press(tile)}>
            <Text bare tint={tile.tint} className="inline-flex">
              <tile.icon size={16} />
            </Text>
          </IconButton>
        ))}
      </Surface>
    );

  const openDeck = viewing ? decks[viewing.id] : undefined;
  const open = viewing ? guides[viewing.id] : undefined;
  if (viewing && (open || openDeck)) {
    const close = () => onView(undefined);
    return (
      <Surface
        as="aside"
        tone="none"
        edge="hairline"
        className={`${paneClass} tutor-studio-pane border-0 border-l`}
        data-viewing="true"
        aria-label="Create"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-3.5 pt-3 pb-4.5">
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
      </Surface>
    );
  }

  return (
    <Surface
      as="aside"
      tone="none"
      edge="hairline"
      className={`${paneClass} tutor-studio-pane border-0 border-l`}
      aria-label="Create"
      data-tour="notebook-create"
    >
      <header className={paneHeadClass}>
        <Text as="h2" size="control" weight="medium" tone="bright" className="ml-1 flex-1">
          Create
        </Text>
        <IconButton label="Hide Create" onClick={() => onCollapse(true)}>
          <PanelRightClose />
        </IconButton>
      </header>
      <div className={paneScrollClass}>
        {/* Two tiles a row while each label fits whole, one when the pane is too narrow. */}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(152px,1fr))] gap-2 px-1">
          {tiles.map((tile) => (
            <Surface
              key={tile.id}
              as={Pressable}
              tint={tile.tint}
              radius="xl"
              wash="tint"
              hovered={tile.id === "reports" && choosing}
              className="flex min-w-0 items-center gap-2.5 p-3 text-left"
              aria-expanded={tile.id === "reports" ? choosing : undefined}
              onClick={() => press(tile)}
            >
              <Text bare tint={tile.tint} className="inline-flex flex-none">
                <tile.icon size={18} />
              </Text>
              <Text size="meta" tone="bright" full>
                {tile.label}
              </Text>
            </Surface>
          ))}
        </div>
        {choosing ? (
          <Surface
            tone="page"
            edge="hairline"
            radius="xl"
            className="mx-1 mt-2.5 flex flex-col gap-0.5 p-1.5"
            role="group"
            aria-label="Reports"
          >
            <div className="flex items-center justify-between">
              <Text size="caption" tone="muted" className="mx-1.5 my-1">
                Reports
              </Text>
              <IconButton label="Close reports" size="sm" onClick={() => setChoosing(false)}>
                <X />
              </IconButton>
            </div>
            {reports
              .filter((report) => report.id !== "data-table")
              .map((report) => (
                <Surface
                  key={report.id}
                  as={Pressable}
                  tone="none"
                  radius="lg"
                  wash="control"
                  className="px-2.5 py-2 text-left"
                  onClick={() => {
                    setChoosing(false);
                    make("guide", report.id);
                  }}
                >
                  <Text bare size="meta" tone="default">
                    {report.title}
                  </Text>
                </Surface>
              ))}
          </Surface>
        ) : null}

        <div className="mt-4 flex flex-col gap-0.5">
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
              <Surface
                key={output.item.id}
                as={Pressable}
                tone="none"
                radius="xl"
                wash="control"
                className={outputClass}
                onClick={() => onView({ id: output.item.id })}
              >
                <Text bare tint={tile.tint} className="inline-flex flex-none">
                  <tile.icon size={16} />
                </Text>
                <Text bare size="meta" tone="default" className={outputTextClass}>
                  <Text full>{output.item.title}</Text>
                  <Text bare size="caption" tone="muted" className="flex-none">
                    {meta} · {shortAgo(output.item.createdAt, now)}
                  </Text>
                </Text>
              </Surface>
            );
          })}
          {/* The tiles above are how to make something, so the empty state offers no button. */}
          {!made.length && !making.length ? (
            <EmptyState
              inline
              title="Nothing made yet"
              line="Pick something above to make from your sources. It’s saved here."
            />
          ) : null}
        </div>
      </div>
    </Surface>
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
    <Surface tone="none" radius="xl" wash="control" className={outputClass} data-state={job.state}>
      <Text bare tint={tile.tint} className="inline-flex flex-none">
        <tile.icon size={16} />
      </Text>
      <Pressable
        className="flex min-w-0 flex-1"
        onClick={() => actions.onChat(job.agentId, job.conversationId)}
      >
        <Text bare size="meta" tone="default" className={outputTextClass}>
          <OverflowFadeText className={failed ? undefined : "misty-shimmer"}>
            {job.title}
          </OverflowFadeText>
          <Text size="caption" tone="muted" className="flex-none">
            {failed
              ? (job.error ?? "Failed")
              : job.state === "queued" && !started
                ? "Waiting for a turn to end"
                : "Making"}
          </Text>
        </Text>
      </Pressable>
      {failed ? (
        <>
          <IconButton label="Try again" onClick={() => void retryJob(job)}>
            <RotateCcw />
          </IconButton>
          <IconButton label="Dismiss" onClick={() => void dismissJob(job)}>
            <X />
          </IconButton>
        </>
      ) : null}
    </Surface>
  );
}
