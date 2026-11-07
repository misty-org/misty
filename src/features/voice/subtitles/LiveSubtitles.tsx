import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AudioLines, History, LoaderCircle, Play, Square, X } from "lucide-react";
import { useEffect, useState, type PointerEvent } from "react";
import { Button, IconButton } from "@/shared/ui";
import { LiveCaptions } from "./LiveCaptions";
import { SubtitleHistory } from "./SubtitleHistory";
import { dragPanel } from "./subtitlePanelDrag";
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

/** This view's window is the one that opened it, and the only one that should hear it. */
const opener = () => getCurrentWindow().label;
const act = (action: SubtitlesAction) => void emitTo(opener(), SUBTITLES_ACTION, action);

/** Everything but what you click or type in moves the panel. */
function drag(event: PointerEvent<HTMLElement>) {
  const interactive = "button, input, textarea, [role='dialog'], [role='listbox'], [role='slider']";
  if (event.button !== 0 || (event.target as Element).closest(interactive)) return;
  dragPanel(event, false);
}

function resize(event: PointerEvent<HTMLElement>) {
  if (event.button !== 0) return;
  event.stopPropagation();
  dragPanel(event, true);
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
 * The subtitles panel, from Audeeo: a view above the tabs of the Misty window that opened it. It
 * only draws what that window sends, and asks that window for every change.
 */
export function LiveSubtitles() {
  const [view, setView] = useState(noSubtitles);
  const [page, setPage] = useState<"captions" | "history">("captions");
  const [open, setOpen] = useState<ControlGroup | null>(null);
  useEffect(() => {
    const remove = getCurrentWebview().listen<SubtitlesView>(SUBTITLES_VIEW, ({ payload }) =>
      setView(payload),
    );
    // This page loads after the first view may have been sent.
    void remove.then(() => emitTo(opener(), SUBTITLES_READY, {})).catch(() => undefined);
    return () => void remove.then((fn) => fn());
  }, []);
  const { prefs } = view;
  const showSource = !!view.source;
  const translation = prefs.mode === "translate" ? view.translation : "";
  return (
    <main className="subtitle-panel" onPointerDown={drag}>
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
      <div className="subtitle-resize" aria-hidden onPointerDown={resize} />
    </main>
  );
}
