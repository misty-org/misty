import { Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import { cn } from "../classNames";
import { IconButton } from "../controls/IconButton";
import { Text } from "../display/Text";

export interface MediaPlayerCardProps {
  title: string;
  /** The artist, or where it plays from. */
  detail?: string;
  /** The track's picture, if it has one. */
  artwork?: string;
  /** The source's own mark at the start of the controls: a music service's logo. */
  source?: ReactNode;
  /** The card's own buttons at its top right, such as opening the source and closing the player. */
  actions?: ReactNode;
  playing: boolean;
  /** Seconds in. The position bar shows only with a position and a length. */
  position?: number | null;
  /** The track's length in seconds. */
  length?: number | null;
  muted?: boolean;
  canPrevious?: boolean;
  canNext?: boolean;
  onPlay(): void;
  onPause(): void;
  onPrevious?(): void;
  onNext?(): void;
  /** Moves playback to `seconds`; left out where the source can't seek. */
  onSeek?(seconds: number): void;
  onToggleMute?(): void;
  /**
   * Just the track, 36px tall (48 in a card padded 6px): the position bar and the transport fold away, and open again
   * when this goes false (the holder opens them on hover or focus).
   */
  compact?: boolean;
  className?: string;
}

/**
 * A media player, laid out like Zen's: the track's artwork and title with the card's own buttons
 * at the top, a position bar that can be dragged, and the transport in the middle beneath it,
 * between the source's mark and a mute button. Previous restarts the track when the source has
 * no previous one; the bar shows only for a finite length. `compact` folds all but the track away.
 * Monochrome: the only color is the artwork and the source's mark.
 */
export function MediaPlayerCard(props: MediaPlayerCardProps) {
  const { playing, length } = props;
  const reported = props.position ?? null;
  const position = useRunningPosition(reported, length ?? null, playing);
  const bar = useRef<HTMLSpanElement>(null);
  // A seek moves the clock at once; the next report replaces it.
  const [sought, setSought] = useState<number | null>(null);
  useEffect(() => setSought(null), [reported]);
  // While the bar is dragged it follows the pointer instead of the reported position.
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
  const seekable = Boolean(props.onSeek);
  const restart = !props.canPrevious && seekable;
  const artworkSize = cn(
    "transition-[width,height] duration-150 ease-out motion-reduce:transition-none",
    props.compact ? "size-9" : "size-11",
  );
  return (
    <div data-slot="media-player" className={cn("grid p-2", props.className)}>
      <div className="flex items-start gap-1">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {props.artwork ? (
            <img
              className={cn("shrink-0 rounded-lg bg-control-hover object-cover", artworkSize)}
              src={props.artwork}
              alt=""
              draggable={false}
              referrerPolicy="no-referrer"
            />
          ) : (
            <span
              aria-hidden="true"
              className={cn("shrink-0 rounded-lg bg-control-hover", artworkSize)}
            />
          )}
          <span className="grid min-w-0">
            <Text size="control" weight="medium" tone="bright">
              {props.title}
            </Text>
            {props.detail ? (
              // A 16px line, so the title and it stand as tall as the 36px artwork at rest.
              <Text size="meta" tone="muted" className="leading-4">
                {props.detail}
              </Text>
            ) : null}
          </span>
        </div>
        {props.actions ? <div className="flex shrink-0 items-center">{props.actions}</div> : null}
      </div>
      {/* Folds to nothing while compact, out of reach of the keyboard too. Its gap is padding on
          the box inside the clipped one: a grid row never shrinks below zero (so a negative margin
          can't take a gap back), and a box is never shorter than its own padding. */}
      <div
        inert={props.compact || undefined}
        className={cn(
          "grid transition-[grid-template-rows,margin,opacity] duration-150 ease-out motion-reduce:transition-none",
          props.compact ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="grid gap-2 pt-2">
            {length && shown != null ? (
              <Text
                bare
                as="div"
                size="caption"
                tone="muted"
                className="flex items-center gap-2 tabular-nums"
              >
                <span>{clock(shown)}</span>
                <span
                  ref={bar}
                  role="slider"
                  // Dragging the bar seeks; it never picks the card up in a dock.
                  data-reorder-ignore=""
                  aria-label="Playback position"
                  aria-valuemin={0}
                  aria-valuemax={Math.round(length)}
                  aria-valuenow={Math.round(shown)}
                  aria-valuetext={`${clock(shown)} of ${clock(length)}`}
                  tabIndex={seekable ? 0 : undefined}
                  data-scrubbing={scrub !== null ? "" : undefined}
                  className={cn(
                    "group/bar relative h-1 flex-1 rounded-full bg-cream/15 outline-none",
                    seekable &&
                      "cursor-pointer touch-none after:absolute after:inset-x-0 after:-inset-y-2 after:content-['']",
                    seekable && "hover:h-1.5 focus-visible:h-1.5 data-[scrubbing]:h-1.5",
                  )}
                  onKeyDown={(event: KeyboardEvent<HTMLSpanElement>) => {
                    if (!seekable) return;
                    const step = event.shiftKey ? 30 : 5;
                    const target =
                      event.key === "ArrowLeft"
                        ? shown - step
                        : event.key === "ArrowRight"
                          ? shown + step
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
                    if (!seekable || event.button !== 0) return;
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
                  <span
                    className="absolute inset-y-0 left-0 rounded-full bg-cream-muted group-data-[scrubbing]/bar:bg-cream-bright"
                    style={{ width: `${(Math.min(shown, length) / length) * 100}%` }}
                  />
                </span>
                <span>{clock(length)}</span>
              </Text>
            ) : null}
            {/* The source at the start, mute at the end, and the transport exactly in the middle. */}
            <div className="grid grid-cols-[1fr_auto_1fr] items-center">
              {/* In a button's 32px square, so its inset matches the mute button's at the other end. */}
              <span className="grid size-8 place-items-center justify-self-start">
                {props.source}
              </span>
              <span className="flex items-center gap-2.5">
                <IconButton
                  label={restart ? "Restart" : "Previous"}
                  disabled={!props.canPrevious && !seekable}
                  onClick={() => (props.canPrevious ? props.onPrevious?.() : seek(0))}
                >
                  <SkipBack aria-hidden="true" />
                </IconButton>
                <IconButton
                  label={playing ? `Pause ${props.title}` : `Play ${props.title}`}
                  onClick={playing ? props.onPause : props.onPlay}
                >
                  {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                </IconButton>
                <IconButton label="Next" disabled={!props.canNext} onClick={() => props.onNext?.()}>
                  <SkipForward aria-hidden="true" />
                </IconButton>
              </span>
              <span className="flex justify-self-end">
                {props.onToggleMute ? (
                  <IconButton label={props.muted ? "Unmute" : "Mute"} onClick={props.onToggleMute}>
                    {props.muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
                  </IconButton>
                ) : null}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The reported position, carried forward on the clock while it plays, until the next report. */
function useRunningPosition(reported: number | null, length: number | null, playing: boolean) {
  const [now, setNow] = useState(() => Date.now());
  const [since, setSince] = useState(() => Date.now());
  useEffect(() => setSince(Date.now()), [reported]);
  useEffect(() => {
    if (!playing || reported == null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [playing, reported]);
  if (reported == null) return null;
  const running = playing ? Math.max(0, now - since) / 1000 : 0;
  return length ? Math.min(length, reported + running) : reported + running;
}

function clock(seconds: number) {
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}
