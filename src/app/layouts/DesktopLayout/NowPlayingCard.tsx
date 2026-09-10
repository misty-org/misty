import { Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import type { BrowserMediaInfo } from "@/features/browser/library";
import { parseBrowserViewState, type WorkspaceView } from "@/features/workspace/model";
import { IconButton, Pressable } from "@/shared/ui";

type Action = "play" | "pause" | "previoustrack" | "nexttrack";

/**
 * One playing tab in the media player: the page's own artwork and title, its
 * position, and its controls. Previous and next show only when the page has
 * them; the progress bar only when the page reports a finite length.
 */
export function NowPlayingCard(props: {
  view: WorkspaceView;
  info?: BrowserMediaInfo;
  paused: boolean;
  muted: boolean;
  onAction(action: Action): void;
  onToggleMute(): void;
  onOpen(): void;
}) {
  const { info, paused, muted } = props;
  const title = info?.title || props.view.title || "Untitled page";
  const site = siteOf(parseBrowserViewState(props.view.state).url);
  const detail = [muted ? "Muted" : "", info?.artist, site].filter(Boolean).join(" · ");
  const length = info?.duration && info.duration < 86_400 ? info.duration : null;
  const position = length && info?.position != null ? Math.min(info.position, length) : null;
  return (
    <div className="misty-now-playing-card">
      <Pressable className="misty-now-playing-top" onClick={props.onOpen} title={`Go to ${title}`}>
        {info?.artwork ? (
          <img className="misty-now-playing-art" src={info.artwork} alt="" draggable={false} />
        ) : (
          <span className="misty-now-playing-art" aria-hidden="true" />
        )}
        <span className="misty-now-playing-meta">
          <span className="misty-now-playing-title">{title}</span>
          {detail ? <span className="misty-now-playing-detail">{detail}</span> : null}
        </span>
      </Pressable>
      {length && position != null ? (
        <div className="misty-now-playing-time">
          <span>{clock(position)}</span>
          <span
            className="misty-now-playing-bar"
            role="progressbar"
            aria-label="Playback position"
            aria-valuemin={0}
            aria-valuemax={Math.round(length)}
            aria-valuenow={Math.round(position)}
          >
            <span style={{ width: `${(position / length) * 100}%` }} />
          </span>
          <span>{clock(length)}</span>
        </div>
      ) : null}
      <div className="misty-now-playing-controls">
        {info?.canPrevious ? (
          <IconButton size="xs" label="Previous" onClick={() => props.onAction("previoustrack")}>
            <SkipBack className="size-4" />
          </IconButton>
        ) : null}
        <IconButton
          size="xs"
          className="misty-now-playing-play"
          label={paused ? `Play ${title}` : `Pause ${title}`}
          onClick={() => props.onAction(paused ? "play" : "pause")}
        >
          {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
        </IconButton>
        {info?.canNext ? (
          <IconButton size="xs" label="Next" onClick={() => props.onAction("nexttrack")}>
            <SkipForward className="size-4" />
          </IconButton>
        ) : null}
        <span className="flex-1" />
        <IconButton
          size="xs"
          label={muted ? `Unmute ${title}` : `Mute ${title}`}
          onClick={props.onToggleMute}
        >
          {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </IconButton>
      </div>
    </div>
  );
}

function siteOf(address: string | null | undefined) {
  try {
    return address ? new URL(address).hostname.replace(/^www\./, "") : "";
  } catch {
    return "";
  }
}

function clock(seconds: number) {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
