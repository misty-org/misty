import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useNotice } from "@/shared/ui";
import { followIsStale, lookForNews } from "../notebookFollow";
import type { TutorActions } from "../TutorPage";
import { jobTitle, notebookContext } from "../tutorPrompts";
import { startJob } from "../tutorRuns";
import { briefKey, briefPrompt } from "../tutorStudio";
import { useTutorStore } from "../tutorStore";
import type { Notebook } from "../tutorTypes";
import { AddSourcesDialog } from "./AddSourcesDialog";
import { ChatPanel } from "./ChatPanel";
import { CustomizeNotebook } from "./CustomizeNotebook";
import { NotebookBar } from "./NotebookBar";
import { NoteReader, SourceReader } from "./Reader";
import { SourcesPanel, type Opened } from "./SourcesPanel";
import { StudioPanel } from "./StudioPanel";
import "./notebookWorkspace.css";

/** Starts the notebook's overview when its sources changed since the last one. */
function useBrief(notebook: Notebook, agentId: string) {
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
    if (!key || reading || briefing || notebook.brief?.sources === key) return;
    // A moment's wait, so adding several sources asks for one overview.
    const timer = window.setTimeout(() => void start().catch(() => undefined), 2500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reading, briefing, notebook.brief?.sources]);
  return { briefing, start };
}

const RAIL = 52;
const MIDDLE_MIN = 360;
const widthsKey = "misty:tutor-pane-widths";
const defaultWidths = { left: 296, right: 336 };

function savedWidths(): { left: number; right: number } {
  try {
    const saved = JSON.parse(localStorage.getItem(widthsKey) ?? "null") as {
      left?: unknown;
      right?: unknown;
    } | null;
    return {
      left: typeof saved?.left === "number" ? saved.left : defaultWidths.left,
      right: typeof saved?.right === "number" ? saved.right : defaultWidths.right,
    };
  } catch {
    return defaultWidths;
  }
}

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
      onDrag(side === "left" ? at + next.clientX - origin : at - (next.clientX - origin));
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
      className="tutor-pane-handle"
      style={side === "left" ? { left: at - 3 } : { right: at - 3 }}
      onPointerDown={start}
      onKeyDown={key}
    />
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
    const observer = new ResizeObserver(([entry]) => setFrameWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const narrow = frameWidth > 0 && frameWidth < 1100;
  const leftClosed = leftChoice ?? narrow;
  const [widths, setWidths] = useState(savedWidths);
  const [dragging, setDragging] = useState(false);
  // An open source or note in the studio wants room; it never makes the studio narrower.
  const rightOpen = viewing ? Math.max(widths.right, 420, frameWidth * 0.46) : widths.right;
  const left = leftClosed ? RAIL : widths.left;
  const right = rightClosed ? RAIL : rightOpen;
  const resize = (side: "left" | "right", width: number) => {
    setDragging(true);
    const other = side === "left" ? right : left;
    const most = Math.max(200, (frameWidth || 1400) - other - MIDDLE_MIN);
    const least = side === "left" ? 200 : 260;
    setWidths((current) => ({
      ...current,
      [side]: Math.round(Math.min(most, Math.max(least, width))),
    }));
  };
  const keepWidths = () => {
    setDragging(false);
    setWidths((current) => {
      try {
        localStorage.setItem(widthsKey, JSON.stringify(current));
      } catch {
        // Kept for this window only.
      }
      return current;
    });
  };
  const { briefing, start } = useBrief(notebook, actions.agentId);
  // A new, empty notebook opens on adding its first sources, unless its agent is finding them.
  useEffect(() => {
    const finding = Object.values(useTutorStore.getState().jobs).some(
      (job) => job.notebookId === notebook.id && job.kind === "research" && job.state !== "failed",
    );
    if (!notebook.sources.length && !notebook.notes.length && !finding) setAdding(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebook.id]);

  // A notebook that follows something takes in recent news as it opens.
  useEffect(() => {
    if (!followIsStale(notebook.follow)) return;
    void lookForNews(notebook.id).then((failed) => failed && setError(failed));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebook.id]);

  const source =
    opened?.kind === "source" ? notebook.sources.find((item) => item.id === opened.id) : undefined;
  const note =
    opened?.kind === "note" ? notebook.notes.find((item) => item.id === opened.id) : undefined;

  return (
    <div className="tutor-notebook-frame">
      <NotebookBar
        notebook={notebook}
        onBack={() => actions.open("")}
        onCustomize={() => setCustomizing(true)}
        onRebrief={() => void start().catch(() => undefined)}
        onError={setError}
      />
      <div
        ref={frame}
        className="tutor-workspace"
        data-left={leftClosed ? "closed" : "open"}
        data-right={rightClosed ? "closed" : viewing ? "wide" : "open"}
        data-dragging={dragging ? "true" : undefined}
        style={{ gridTemplateColumns: `${left}px minmax(0, 1fr) ${right}px` }}
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
        />
        <div className="tutor-workspace-middle">
          {source ? (
            <SourceReader
              notebook={notebook}
              source={source}
              agentId={actions.agentId}
              onClose={() => setOpened(undefined)}
              onError={setError}
            />
          ) : opened?.kind === "new-note" || note ? (
            <NoteReader notebook={notebook} note={note} onClose={() => setOpened(undefined)} />
          ) : (
            <ChatPanel
              notebook={notebook}
              actions={actions}
              briefing={briefing}
              onCite={(index) => {
                const cited = notebook.sources[index - 1];
                if (cited) setOpened({ kind: "source", id: cited.id });
              }}
              onAdd={() => setAdding(true)}
              onBrief={() => void start().catch(() => undefined)}
              onError={setError}
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
    </div>
  );
}
