import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AudioLines, History, LoaderCircle, Play, Square, X } from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";
import { Button, IconButton } from "@/shared/ui";
import { LiveCaptions } from "./LiveCaptions";
import { SubtitleHistory } from "./SubtitleHistory";
import { SubtitleSetup } from "./SubtitleSetup";
import { SubtitleToolbar, type ControlGroup } from "./SubtitleToolbar";
import {
  noSubtitles,
  SUBTITLES_ACTION,
  SUBTITLES_READY,
  SUBTITLES_VIEW,
  type SubtitlesAction,
  type SubtitlesView,
} from "./subtitlesView";
import "./liveSubtitles.css";

const act = (action: SubtitlesAction) => void emit(SUBTITLES_ACTION, action);

/** Everything but what you click or type in moves the window. */
function drag(event: MouseEvent) {
  const interactive = "button, input, textarea, [role='dialog'], [role='listbox'], [role='slider']";
  if (event.button !== 0 || (event.target as Element).closest(interactive)) return;
  void getCurrentWindow()
    .startDragging()
    .catch(() => undefined);
}

/** In the middle of the panel until it's listening; then Stop sits in the header. */
function SessionToggle({ view }: { view: SubtitlesView }) {
  if (view.status === "live") return null;
  const idle = view.status === "idle";
  const label = idle ? "Start subtitles" : view.status === "connecting" ? "Starting" : "Finishing";
  return (
    <Button
      variant="secondary"
      className={`subtitle-toggle${idle ? " is-start" : ""}`}
      disabled={!idle}
      onClick={() => act({ type: "start" })}
    >
      {idle ? <Play aria-hidden /> : <LoaderCircle className="subtitle-busy" aria-hidden />}
      <span>{label}</span>
    </Button>
  );
}

/**
 * The floating subtitles panel (window misty-live-subtitles), from Audeeo. It only draws what the
 * window that opened it sends, and asks that window for every change.
 */
export function LiveSubtitles() {
  const [view, setView] = useState(noSubtitles);
  const [page, setPage] = useState<"captions" | "history">("captions");
  const [open, setOpen] = useState<ControlGroup | null>(null);
  useEffect(() => {
    const remove = getCurrentWindow().listen<SubtitlesView>(SUBTITLES_VIEW, ({ payload }) =>
      setView(payload),
    );
    // This page loads after the first view may have been sent.
    void remove.then(() => emit(SUBTITLES_READY, {})).catch(() => undefined);
    return () => void remove.then((fn) => fn());
  }, []);
  const { prefs } = view;
  const showSource = !!view.source;
  const translation = prefs.mode === "translate" ? view.translation : "";
  return (
    <main className="subtitle-panel" onMouseDown={drag}>
      <header className="subtitle-header">
        <div className="subtitle-header-leading">
          {page === "history" ? (
            <h1 className="subtitle-title">History</h1>
          ) : (
            <SubtitleSetup view={view} paused={open !== null} onOpen={setOpen} />
          )}
        </div>
        {view.status === "live" && (
          <IconButton label="Stop subtitles" onClick={() => act({ type: "stop" })}>
            <Square size={16} aria-hidden />
          </IconButton>
        )}
        <IconButton
          label="Subtitles"
          aria-pressed={page === "captions"}
          onClick={() => setPage("captions")}
        >
          <AudioLines size={16} aria-hidden />
        </IconButton>
        <IconButton
          label="History"
          aria-pressed={page === "history"}
          onClick={() => {
            setOpen(null);
            setPage("history");
          }}
        >
          <History size={16} aria-hidden />
        </IconButton>
        <IconButton label="Close subtitles" onClick={() => act({ type: "close" })}>
          <X size={16} aria-hidden />
        </IconButton>
      </header>
      {page === "history" ? (
        <SubtitleHistory view={view} act={act} />
      ) : (
        <div className="subtitle-content">
          {showSource || translation ? (
            <LiveCaptions
              source={view.source}
              translation={translation}
              sourceLanguage={prefs.source}
              targetLanguage={prefs.target}
            />
          ) : null}
          <SessionToggle view={view} />
        </div>
      )}
      {view.notice && (
        <div className="subtitle-notice" role="alert">
          <span>{view.notice}</span>
          <IconButton label="Dismiss" size="xs" onClick={() => act({ type: "dismiss" })}>
            <X size={14} aria-hidden />
          </IconButton>
        </div>
      )}
      {page === "captions" && (
        <SubtitleToolbar view={view} act={act} open={open} setOpen={setOpen} />
      )}
    </main>
  );
}
