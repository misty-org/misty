import * as React from "react";

import { cn } from "../classNames";
import { OverflowFadeText } from "../layout/OverflowFadeText";

/** The four corners a picture-in-picture rests in. */
export type PipCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/** How far it rests from its container's edges, and how far a press travels before it's a drag. */
const MARGIN = 12;
const DRAG_START = 4;

type Point = { x: number; y: number };

export interface FloatingPipProps {
  /** Its accessible name, such as "Agent browser". */
  label: string;
  /** The picture, filling the frame edge to edge (an img or a blank span). */
  picture: React.ReactNode;
  /** What it shows, along its foot over the picture. */
  caption?: string;
  /** How it's going, after the caption: a status word. */
  status?: string;
  /** IconButtons at its top right, shown while the pointer is over it or focus is in it. */
  actions?: React.ReactNode;
  corner: PipCorner;
  onCornerChange(corner: PipCorner): void;
  /** A press that isn't a drag: opens what the picture is of. */
  onOpen(): void;
  /** What a press opens, for its accessible name: "Open the agent browser". */
  openLabel: string;
  /** Let go past its container's right edge: puts it back where it docks. */
  onDock?(): void;
  /** Something is at work in it: a white ring breathes around it. */
  active?: boolean;
  /**
   * A selector for something in the container it keeps clear of at the top, such as a header
   * floating over the container's top edge.
   */
  clearOf?: string;
}

/**
 * A picture-in-picture: a small live picture floating over its container (the nearest positioned
 * ancestor), moved like the system's own. Drag it anywhere; let go and it glides to the nearest
 * corner, where it stays. A press opens what it shows; let go past the right edge and it docks.
 * Its controls show on hover, over the picture, and a white ring breathes around it while
 * something in it works.
 *
 * ```tsx
 * <FloatingPip label="Agent browser" picture={<img src={shot} alt="" />} corner={corner}
 *   onCornerChange={setCorner} onOpen={dock} openLabel="Open the agent browser" active={working}
 *   actions={<IconButton label="Close" onClick={close}><X /></IconButton>} />
 * ```
 */
export function FloatingPip({
  label,
  picture,
  caption,
  status,
  actions,
  corner,
  onCornerChange,
  onOpen,
  openLabel,
  onDock,
  active = false,
  clearOf,
}: FloatingPipProps) {
  const frame = React.useRef<HTMLDivElement>(null);
  // Where it is while dragged (its top left in the container), else null and its corner decides.
  const [dragged, setDragged] = React.useState<Point | null>(null);
  const [gliding, setGliding] = React.useState(false);
  const [resting, setResting] = React.useState<Point | null>(null);
  const press = React.useRef<{ start: Point; offset: Point; moved: boolean } | null>(null);
  const [topInset, setTopInset] = React.useState(0);

  // Where its corner is in the container, kept current as the container or the picture resizes.
  const place = React.useCallback(() => {
    const element = frame.current;
    const box = element?.offsetParent as HTMLElement | null;
    if (!element || !box) return;
    const above = clearOf ? box.querySelector(clearOf) : null;
    const inset = above
      ? Math.max(0, above.getBoundingClientRect().bottom - box.getBoundingClientRect().top)
      : 0;
    setTopInset(inset);
    const right = box.clientWidth - element.offsetWidth - MARGIN;
    const bottom = box.clientHeight - element.offsetHeight - MARGIN;
    setResting({
      x: corner.endsWith("left") ? MARGIN : Math.max(MARGIN, right),
      y: corner.startsWith("top") ? MARGIN + inset : Math.max(MARGIN + inset, bottom),
    });
  }, [corner, clearOf]);

  React.useLayoutEffect(() => {
    place();
    const element = frame.current;
    const box = element?.offsetParent;
    if (!element || !box) return;
    const observer = new ResizeObserver(place);
    observer.observe(box);
    observer.observe(element);
    return () => observer.disconnect();
  }, [place]);

  const nearest = (point: Point): PipCorner => {
    const element = frame.current!;
    const box = element.offsetParent as HTMLElement;
    const middle = {
      x: point.x + element.offsetWidth / 2,
      y: point.y + element.offsetHeight / 2,
    };
    const vertical = middle.y < box.clientHeight / 2 ? "top" : "bottom";
    const horizontal = middle.x < box.clientWidth / 2 ? "left" : "right";
    return `${vertical}-${horizontal}`;
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Its own buttons keep their presses.
    if (event.button !== 0 || (event.target as Element).closest("[data-pip-action]")) return;
    const element = frame.current;
    if (!element) return;
    const at = { x: element.offsetLeft, y: element.offsetTop };
    press.current = {
      start: { x: event.clientX, y: event.clientY },
      offset: { x: event.clientX - at.x, y: event.clientY - at.y },
      moved: false,
    };
    element.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = press.current;
    const element = frame.current;
    if (!current || !element) return;
    const travelled = Math.hypot(event.clientX - current.start.x, event.clientY - current.start.y);
    if (!current.moved && travelled < DRAG_START) return;
    current.moved = true;
    setGliding(false);
    const box = element.offsetParent as HTMLElement;
    // Held inside the container, with room to be pulled a little past its right edge to dock.
    const maxX = box.clientWidth - element.offsetWidth + (onDock ? element.offsetWidth / 2 : 0);
    setDragged({
      x: Math.min(Math.max(event.clientX - current.offset.x, 0), maxX),
      y: Math.min(
        Math.max(event.clientY - current.offset.y, topInset),
        box.clientHeight - element.offsetHeight,
      ),
    });
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = press.current;
    press.current = null;
    const element = frame.current;
    if (!current || !element) return;
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    if (!current.moved) {
      onOpen();
      return;
    }
    const box = (element.offsetParent as HTMLElement).getBoundingClientRect();
    if (onDock && event.clientX > box.right - MARGIN) {
      setDragged(null);
      onDock();
      return;
    }
    const at = dragged ?? { x: element.offsetLeft, y: element.offsetTop };
    const next = nearest(at);
    setGliding(true);
    setDragged(null);
    if (next !== corner) onCornerChange(next);
  };

  const at = dragged ?? resting;
  return (
    <div
      ref={frame}
      role="group"
      aria-label={label}
      data-slot="floating-pip"
      data-dragging={dragged ? "" : undefined}
      className={cn(
        "group/pip absolute top-0 left-0 z-[var(--stack-raised)] w-72 max-w-[calc(100%-1.5rem)]",
        "cursor-grab touch-none select-none overflow-hidden rounded-xl bg-charcoal-card",
        "shadow-[0_8px_28px_rgb(0_0_0/0.45),0_0_0_0.5px_rgb(255_255_255/0.08)]",
        "data-[dragging]:cursor-grabbing data-[dragging]:shadow-[0_14px_40px_rgb(0_0_0/0.55),0_0_0_0.5px_rgb(255_255_255/0.12)]",
        gliding && "transition-transform duration-200 ease-out motion-reduce:transition-none",
        !at && "invisible",
      )}
      style={{ transform: at ? `translate(${at.x}px, ${at.y}px)` : undefined }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        press.current = null;
        setDragged(null);
      }}
      onTransitionEnd={() => setGliding(false)}
    >
      <button
        type="button"
        aria-label={openLabel}
        // A press on the picture opens it; the frame's pointer handling does the work, so the
        // button is here for the keyboard.
        onClick={(event) => {
          if (event.detail === 0) onOpen();
        }}
        className={cn(
          "block aspect-[16/10] w-full cursor-[inherit] overflow-hidden outline-none focus-visible:opacity-90",
          "[&>*]:block [&>*]:size-full [&>img]:object-cover [&>img]:object-top",
        )}
      >
        {picture}
      </button>
      {caption ? (
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 flex min-w-0 items-center gap-2",
            "bg-linear-to-t from-black/70 to-transparent px-3 pt-6 pb-2 text-caption text-white",
          )}
        >
          <OverflowFadeText className="min-w-0">{caption}</OverflowFadeText>
          {status ? <span className="shrink-0 text-micro text-white/70">{status}</span> : null}
        </div>
      ) : null}
      {actions ? (
        <div
          data-pip-action=""
          className={cn(
            "absolute top-1.5 right-1.5 flex items-center gap-0.5 rounded-lg bg-black/55 p-0.5 text-white backdrop-blur-sm",
            "opacity-0 transition-opacity duration-150 group-hover/pip:opacity-100 group-focus-within/pip:opacity-100",
            "[&_[data-slot=button]]:text-white",
          )}
        >
          {actions}
        </div>
      ) : null}
      {/* The ring sits over the picture's edge, so it shows on any picture. */}
      {active ? (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-0 rounded-xl",
            "animate-[misty-ring-pulse_1.6s_ease-in-out_infinite] motion-reduce:animate-none",
            "motion-reduce:shadow-[inset_0_0_0_1.5px_rgb(255_255_255/0.9)]",
          )}
        />
      ) : null}
    </div>
  );
}
