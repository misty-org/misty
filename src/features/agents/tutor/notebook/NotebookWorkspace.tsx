import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { createDeviceSetting } from "@/shared/lib/deviceSetting";
import { Separator, Surface, useNotice } from "@misty/ui";
import { followIsStale, lookForNews } from "../notebookFollow";
import type { TutorActions } from "../TutorPage";
import { jobTitle, notebookContext } from "../tutorPrompts";
import { startJob } from "../tutorRuns";
import { briefKey, briefPrompt } from "../tutorStudio";
import { firstOpening, useTutorStore } from "../tutorStore";
import type { Notebook } from "../tutorTypes";
import { AddSourcesDialog } from "./AddSourcesDialog";
import { ChatPanel } from "./ChatPanel";
import { CustomizeNotebook } from "./CustomizeNotebook";
import { NotebookBar } from "./NotebookBar";
import { spacesGateway } from "../../spaces-gateway/spacesGateway";
import { claimRun, useHeldNotebook } from "../notebookLive";
import { setPresence, usePeople, usePublishPointer } from "../notebookPresence";
import { useNotebookAgents, usePublishAgents } from "../notebookAgents";
import { LivePointers } from "./LivePeople";
import { NotebookPeople } from "./NotebookPeople";
import { NoteReader, SourceReader } from "./Reader";
import { SourcesPanel, type Opened } from "./SourcesPanel";
import { StudioPanel } from "./StudioPanel";
import "./tutorPresentation.css";
import { designPx, remCss } from "@misty/ui";

/**
 * Starts the notebook's overview when its sources changed since the last one. In a notebook
 * people work in together, one computer writes it for everyone (`claimRun`), once its doc is here.
 */
function useBrief(notebook: Notebook, agentId: string, ready: boolean) {
  const jobs = useTutorStore((state) => state.jobs);
  const briefing = Object.values(jobs).some(
    (job) =>
      job.notebookId === notebook.id &&
      job.kind === "brief" &&
      (job.state === "queued" || job.state === "running"),
  );
  const key = briefKey(notebook);
  const reading = notebook.sources.some((source) => source.reading);
  const start = () =>
    startJob({
      kind: "brief",
      title: jobTitle("brief", notebook.title),
      agentId,
      notebookId: notebook.id,
      prompt: briefPrompt(notebook, notebookContext(notebook)),
    });
  useEffect(() => {
    if (!ready || !key || reading || briefing || notebook.brief?.sources === key) return;
    // A moment's wait, so adding several sources asks for one overview.
    const timer = window.setTimeout(
      () =>
        void claimRun(notebook.id, "brief")
          .then((mine) => (mine ? start() : undefined))
          .catch(() => undefined),
      2500,
    );
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key, reading, briefing, notebook.brief?.sources]);
  return { briefing, start };
}

const RAIL = 52;
const MIDDLE_MIN = 360;
const defaultWidths = { left: 296, right: 336 };

/** How wide the sources and studio panes were left, kept for this device in `misty.db`. */
const usePaneWidths = createDeviceSetting<{ left: number; right: number }>({
  scope: "tutor-pane-widths",
  defaults: defaultWidths,
  normalize: (stored) => {
    const saved = stored as { left?: unknown; right?: unknown } | null;
    return {
      left: typeof saved?.left === "number" ? saved.left : defaultWidths.left,
      right: typeof saved?.right === "number" ? saved.right : defaultWidths.right,
    };
  },
  legacyKey: "misty:tutor-pane-widths",
});

/** A hairline between two panes that drags to resize the side it belongs to. */
function PaneHandle({
  side,
  at,
  label,
  onDrag,
  onDone,
}: {
  side: "left" | "right";
  /** Distance from that side's edge of the workspace, in pixels. */
  at: number;
  label: string;
  onDrag(width: number): void;
  onDone(): void;
}) {
  const start = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    const origin = event.clientX;
    handle.setPointerCapture(event.pointerId);
    const move = (next: globalThis.PointerEvent) =>
      // Widths are design pixels (shared/lib/uiScale.ts); the pointer moves in CSS pixels.
      onDrag(
        side === "left"
          ? at + designPx(next.clientX - origin)
          : at - designPx(next.clientX - origin),
      );
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      onDone();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 48 : 16;
    const grow = side === "left" ? "ArrowRight" : "ArrowLeft";
    const shrink = side === "left" ? "ArrowLeft" : "ArrowRight";
    if (event.key !== grow && event.key !== shrink) return;
    event.preventDefault();
    onDrag(at + (event.key === grow ? step : -step));
    onDone();
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(at)}
      tabIndex={0}
      className={
        "group/handle absolute inset-y-0 z-[var(--stack-above-2)] w-1.5 cursor-col-resize " +
        "touch-none outline-none"
      }
      style={side === "left" ? { left: remCss(at - 3) } : { right: remCss(at - 3) }}
      onPointerDown={start}
      onKeyDown={key}
    >
      {/* The hairline shows while the handle is hovered or focused. */}
      <Separator
        orientation="vertical"
        strong
        className="mx-auto w-0.5 opacity-0 group-hover/handle:opacity-100 group-focus-visible/handle:opacity-100"
      />
    </div>
  );
}

/**
 * One notebook after NotebookLM: a bar with its name, settings and actions, then three flat panes:
 * sources at the left, the conversation in the middle (or a source or note opened from the left),
 * and the studio at the right. Either side folds to a rail, and either open side drags wider or
 * narrower by its hairline; the widths are kept on this device.
 */
export function NotebookWorkspace({
  notebook,
  actions,
}: {
  notebook: Notebook;
  actions: TutorActions;
}) {
  const [error, setError] = useState("");
  useNotice(Boolean(error), { message: error, tone: "error", onDismiss: () => setError("") });
  const [adding, setAdding] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [opened, setOpened] = useState<Opened | { kind: "new-note" }>();
  const [viewing, setViewing] = useState<{ id: string; review?: boolean }>();
  // A side the person hasn't folded or opened follows the width: a narrow notebook starts with
  // its sources folded to a rail.
  const [leftChoice, setLeftClosed] = useState<boolean>();
  const [rightClosed, setRightClosed] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const [frameWidth, setFrameWidth] = useState(0);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    // In design pixels, like the pane widths it is weighed against.
    const observer = new ResizeObserver(([entry]) =>
      setFrameWidth(designPx(entry.contentRect.width)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const narrow = frameWidth > 0 && frameWidth < 1100;
  const leftClosed = leftChoice ?? narrow;
  const storedWidths = usePaneWidths((state) => state.value);
  const [widths, setWidths] = useState(storedWidths);
  const [dragging, setDragging] = useState(false);
  // The stored widths arrive after the first frame, or from another window; a drag wins.
  const [shownWidths, setShownWidths] = useState(storedWidths);
  if (shownWidths !== storedWidths && !dragging) {
    setShownWidths(storedWidths);
    setWidths(storedWidths);
  }
  // An open source or note in the studio wants room; it never makes the studio narrower.
  const rightOpen = viewing ? Math.max(widths.right, 420, frameWidth * 0.46) : widths.right;
  const left = leftClosed ? RAIL : widths.left;
  const right = rightClosed ? RAIL : rightOpen;
  // The latest widths, current even within one tick (a key press resizes and ends at once), so
  // the save at the end of a drag keeps where it ended, not where it began.
  const latestWidths = useRef(widths);
  latestWidths.current = widths;
  const resize = (side: "left" | "right", width: number) => {
    setDragging(true);
    const other = side === "left" ? right : left;
    const most = Math.max(200, (frameWidth || 1400) - other - MIDDLE_MIN);
    const least = side === "left" ? 200 : 260;
    const next = {
      ...latestWidths.current,
      [side]: Math.round(Math.min(most, Math.max(least, width))),
    };
    latestWidths.current = next;
    setWidths(next);
  };
  const keepWidths = () => {
    setDragging(false);
    usePaneWidths.getState().set(latestWidths.current);
  };
  // The notebook's doc in its Space, where everyone in it works on it live.
  const live = useHeldNotebook(notebook);
  const ready = !notebook.space || Boolean(live);
  const { briefing, start } = useBrief(notebook, actions.agentId, ready);
  // A notebook just made here opens on adding its first sources, unless its agent is finding
  // them. One in a Space waits for its doc, which may already hold what others added.
  const askedForSources = useRef(false);
  useEffect(() => {
    if (!ready || askedForSources.current) return;
    askedForSources.current = true;
    // Only the first time it opens after being made here; an empty notebook opened later, or
    // one someone else made, opens on its chat.
    if (!firstOpening(notebook.id)) return;
    const finding = Object.values(useTutorStore.getState().jobs).some(
      (job) => job.notebookId === notebook.id && job.kind === "research" && job.state !== "failed",
    );
    const current = useTutorStore.getState().notebooks[notebook.id];
    if (current && !current.sources.length && !current.notes.length && !finding) setAdding(true);
  }, [notebook.id, ready]);

  // A notebook that follows something takes in recent news as it opens, on one computer.
  useEffect(() => {
    if (!ready || !followIsStale(notebook.follow)) return;
    void claimRun(notebook.id, "news", 5 * 60_000).then(async (mine) => {
      if (!mine) return;
      const failed = await lookForNews(notebook.id);
      if (failed) setError(failed);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebook.id, ready]);

  const source =
    opened?.kind === "source" ? notebook.sources.find((item) => item.id === opened.id) : undefined;
  const note =
    opened?.kind === "note" ? notebook.notes.find((item) => item.id === opened.id) : undefined;

  // Everyone else in the notebook, and what this person is doing in it for them.
  const people = usePeople(notebook.id);
  usePublishPointer(notebook.id, frame);
  // Agents are in the notebook too: this person's say what they're doing, and everyone's show.
  usePublishAgents(notebook.id);
  const agents = useNotebookAgents(notebook.id);
  const spaceId = notebook.space?.spaceId;
  const docId = notebook.space?.docId;
  const openItem = source?.id ?? note?.id ?? viewing?.id;
  useEffect(() => {
    if (live) setPresence(notebook.id, { item: openItem });
  }, [live, notebook.id, openItem]);
  useEffect(() => {
    const gateway = spacesGateway.maybe();
    if (!gateway || !spaceId || !docId) return;
    gateway.setPlace({ spaceId, place: "lab", itemId: docId });
    return () => gateway.leavePlace("lab", docId);
  }, [spaceId, docId]);

  return (
    <Surface tone="page" className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <NotebookBar
        notebook={notebook}
        onBack={() => actions.open("")}
        onCustomize={() => setCustomizing(true)}
        onRebrief={() => void start().catch(() => undefined)}
        onError={setError}
        people={<NotebookPeople notebook={notebook} people={people} agents={agents} />}
      />
      <div
        ref={frame}
        className={
          "relative grid min-h-0 w-full flex-1 transition-[grid-template-columns] duration-180 " +
          "ease-[ease] motion-reduce:transition-none data-[dragging=true]:cursor-col-resize " +
          "data-[dragging=true]:transition-none data-[dragging=true]:select-none"
        }
        data-left={leftClosed ? "closed" : "open"}
        data-right={rightClosed ? "closed" : viewing ? "wide" : "open"}
        data-dragging={dragging ? "true" : undefined}
        style={{ gridTemplateColumns: `${remCss(left)} minmax(0, 1fr) ${remCss(right)}` }}
      >
        <SourcesPanel
          notebook={notebook}
          agentId={actions.agentId}
          collapsed={leftClosed}
          opened={opened?.kind === "new-note" ? undefined : opened}
          onCollapse={setLeftClosed}
          onAdd={() => setAdding(true)}
          onOpen={setOpened}
          onNewNote={() => setOpened({ kind: "new-note" })}
          onError={setError}
          people={people}
          agents={agents}
        />
        <div
          className="relative flex min-h-0 min-w-0"
          data-live-pane={source || note || opened?.kind === "new-note" ? "reader" : "chat"}
        >
          {source ? (
            <SourceReader
              notebook={notebook}
              source={source}
              agentId={actions.agentId}
              onClose={() => setOpened(undefined)}
              onError={setError}
            />
          ) : opened?.kind === "new-note" || note ? (
            <NoteReader
              notebook={notebook}
              note={note}
              people={people}
              onClose={() => setOpened(undefined)}
            />
          ) : (
            <ChatPanel
              notebook={notebook}
              actions={actions}
              briefing={briefing}
              onCite={(cited) => {
                const id = typeof cited === "string" ? cited : notebook.sources[cited - 1]?.id;
                if (id && notebook.sources.some((item) => item.id === id))
                  setOpened({ kind: "source", id });
              }}
              onAdd={() => setAdding(true)}
              onBrief={() => void start().catch(() => undefined)}
              onError={setError}
              people={people}
              agents={agents}
            />
          )}
        </div>
        <StudioPanel
          notebook={notebook}
          actions={actions}
          collapsed={rightClosed}
          viewing={viewing}
          onCollapse={setRightClosed}
          onView={setViewing}
          onError={setError}
          people={people}
          agents={agents}
        />
        {leftClosed ? null : (
          <PaneHandle
            side="left"
            at={left}
            label="Resize sources"
            onDrag={(width) => resize("left", width)}
            onDone={keepWidths}
          />
        )}
        {rightClosed ? null : (
          <PaneHandle
            side="right"
            at={right}
            label="Resize Create"
            onDrag={(width) => resize("right", width)}
            onDone={keepWidths}
          />
        )}
        <LivePointers frame={frame} people={people} />
        <AddSourcesDialog
          notebook={notebook}
          agentId={actions.agentId}
          open={adding}
          onClose={() => setAdding(false)}
          onError={setError}
        />
      </div>
      <CustomizeNotebook
        notebook={notebook}
        open={customizing}
        onClose={() => setCustomizing(false)}
      />
    </Surface>
  );
}
