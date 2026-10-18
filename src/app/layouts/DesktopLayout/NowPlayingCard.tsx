import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  Pause,
  PictureInPicture2,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { BrowserMediaInfo } from "@/features/browser/library";
import { parseBrowserViewState, type WorkspaceView } from "@/features/workspace/model";
import { IconButton, MarqueeGroup, OverflowFadeText, PlaybackClock, Pressable } from "@/shared/ui";

type Action = "play" | "pause" | "previoustrack" | "nexttrack";

/**
 * One playing tab in the media player, laid out like Zen's: the page's artwork and title with
 * picture in picture and close at the top, a position bar you can drag, and the page's
 * controls beneath it beside its icon and a mute button. Previous and next show only when the
 * page has them; the bar only when the page reports a finite length.
 */
export function NowPlayingCard(props: {
  view: WorkspaceView;
  info?: BrowserMediaInfo;
  paused: boolean;
  muted: boolean;
  onAction(action: Action): void;
  onToggleMute(): void;
  onOpen(): void;
  /** Moves playback to `seconds`. */
  onSeek?(seconds: number): void;
  /** Present when picture in picture is available. */
  onPictureInPicture?(): void;
  /** This page's video is floating now, so the button reads pressed. */
  pictureInPictureActive?: boolean;
  /** Closes the card: the breadcrumbs that switch between sources. */
  footer?: ReactNode;
  /** Stops the player: the page is paused and the card goes away. */
  onClose?(): void;
}) {
  const { info, paused, muted } = props;
  const state = parseBrowserViewState(props.view.state);
  const title = info?.title || props.view.title || "Untitled page";
  const site = siteOf(state.url);
  const detail = [muted ? "Muted" : "", info?.artist, site].filter(Boolean).join(" · ");
  const length = info?.duration && info.duration < 86_400 ? info.duration : null;
  const position = length && info?.position != null ? Math.min(info.position, length) : null;
  const bar = useRef<HTMLSpanElement>(null);
  // A seek moves the clock at once; the next report from the page, or another source, replaces it.
  const [sought, setSought] = useState<number | null>(null);
  useEffect(() => setSought(null), [position, props.view.id]);
  // While the bar is dragged it follows the pointer instead of the page's reported position.
  const [scrub, setScrub] = useState<number | null>(null);
  const seek = (seconds: number) => {
    setSought(seconds);
    props.onSeek?.(seconds);
  };
  const at = (event: PointerEvent<HTMLElement>) => {
    const rect = bar.current?.getBoundingClientRect();
    if (!rect || !length) return 0;
    return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * length;
  };
  const shown = scrub ?? sought ?? position;
  return (
    <div className="misty-now-playing-card">
      <div className="misty-now-playing-header">
        <Pressable
          className="misty-now-playing-top"
          onClick={props.onOpen}
          title={`Go to ${title}`}
        >
          {info?.artwork ? (
            <img className="misty-now-playing-art" src={info.artwork} alt="" draggable={false} />
          ) : null}
          <span className="misty-now-playing-meta">
            <MarqueeGroup>
              <OverflowFadeText marquee className="misty-now-playing-title">
                {title}
              </OverflowFadeText>
              {detail ? (
                <OverflowFadeText marquee className="misty-now-playing-detail">
                  {detail}
                </OverflowFadeText>
              ) : null}
            </MarqueeGroup>
          </span>
        </Pressable>
        <div className="misty-now-playing-actions">
          {props.onPictureInPicture ? (
            <IconButton
              size="xs"
              label="Picture in picture"
              aria-pressed={Boolean(props.pictureInPictureActive)}
              onClick={props.onPictureInPicture}
            >
              <PictureInPicture2 className="size-4" />
            </IconButton>
          ) : null}
          {props.onClose ? (
            <IconButton size="xs" label={`Close player for ${title}`} onClick={props.onClose}>
              <X className="size-4" />
            </IconButton>
          ) : null}
        </div>
      </div>
      {length && shown != null ? (
        <PlaybackClock
          className="misty-now-playing-time"
          position={shown}
          length={length}
          playing={!paused && scrub === null}
        >
          <span
            className="playback-elapsed"
            data-hours={length >= 3600 ? "true" : undefined}
            aria-hidden="true"
          />
          <span
            ref={bar}
            className="misty-now-playing-bar"
            role="slider"
            aria-label="Playback position"
            aria-valuemin={0}
            aria-valuemax={Math.round(length)}
            aria-valuenow={Math.round(shown)}
            aria-valuetext={`${clock(shown)} of ${clock(length)}`}
            tabIndex={props.onSeek ? 0 : undefined}
            data-seekable={props.onSeek ? "true" : undefined}
            data-scrubbing={scrub !== null ? "true" : undefined}
            onKeyDown={(event: KeyboardEvent<HTMLSpanElement>) => {
              if (!props.onSeek || shown == null) return;
              const target =
                event.key === "ArrowLeft"
                  ? shown - (event.shiftKey ? 30 : 5)
                  : event.key === "ArrowRight"
                    ? shown + (event.shiftKey ? 30 : 5)
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? length
                        : null;
              if (target === null) return;
              event.preventDefault();
              seek(Math.min(length, Math.max(0, target)));
            }}
            onPointerDown={(event) => {
              if (!props.onSeek || event.button !== 0) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              setScrub(at(event));
            }}
            onPointerMove={(event) => {
              if (scrub !== null) setScrub(at(event));
            }}
            onPointerUp={(event) => {
              if (scrub === null) return;
              seek(at(event));
              setScrub(null);
            }}
            onPointerCancel={() => setScrub(null)}
          >
            <span />
          </span>
          <span>{clock(length)}</span>
        </PlaybackClock>
      ) : null}
      <div className="misty-now-playing-controls">
        {state.faviconUrl ? (
          <img
            className="misty-now-playing-source"
            src={state.faviconUrl}
            alt=""
            draggable={false}
          />
        ) : (
          <span className="misty-now-playing-source" aria-hidden="true" />
        )}
        <span className="misty-now-playing-transport">
          <IconButton
            size="xs"
            label={info?.canPrevious ? "Previous" : "Restart"}
            disabled={!info?.canPrevious && !props.onSeek}
            // A page with no previous track restarts this one, like a player's first press.
            onClick={() => (info?.canPrevious ? props.onAction("previoustrack") : seek(0))}
          >
            <SkipBack className="size-4" />
          </IconButton>
          <IconButton
            size="xs"
            label={paused ? `Play ${title}` : `Pause ${title}`}
            onClick={() => props.onAction(paused ? "play" : "pause")}
          >
            {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
          </IconButton>
          <IconButton
            size="xs"
            label="Next"
            disabled={!info?.canNext}
            onClick={() => props.onAction("nexttrack")}
          >
            <SkipForward className="size-4" />
          </IconButton>
        </span>
        <IconButton
          size="xs"
          label={muted ? `Unmute ${title}` : `Mute ${title}`}
          onClick={props.onToggleMute}
        >
          {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </IconButton>
      </div>
      {props.footer}
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
