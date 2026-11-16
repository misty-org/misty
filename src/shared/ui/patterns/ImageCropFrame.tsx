import * as React from "react";
import { cn } from "../classNames";

/** A crop, as fractions (0 to 1) of the image it sits on. */
export type CropRect = { x: number; y: number; width: number; height: number };

type Handle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** The smallest a crop gets, in on-screen pixels, so its handles never overlap. */
const minPx = 48;
/** How far an arrow key moves or resizes the crop, in on-screen pixels (Shift: ten times). */
const keyStepPx = 2;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/**
 * The crop after dragging `handle` by (dx, dy), as fractions. `ratio` holds it to that width over
 * height in the image's pixels; `frame` is the image's on-screen size.
 */
export function dragCrop(
  start: CropRect,
  handle: Handle,
  dx: number,
  dy: number,
  frame: { width: number; height: number },
  ratio: number | null,
): CropRect {
  const minW = Math.min(1, minPx / Math.max(1, frame.width));
  const minH = Math.min(1, minPx / Math.max(1, frame.height));
  if (handle === "move") {
    return {
      ...start,
      x: clamp(start.x + dx, 0, 1 - start.width),
      y: clamp(start.y + dy, 0, 1 - start.height),
    };
  }
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (handle.includes("w")) left = clamp(left + dx, 0, right - minW);
  if (handle.includes("e")) right = clamp(right + dx, left + minW, 1);
  if (handle.includes("n")) top = clamp(top + dy, 0, bottom - minH);
  if (handle.includes("s")) bottom = clamp(bottom + dy, top + minH, 1);
  if (!ratio) return { x: left, y: top, width: right - left, height: bottom - top };

  // Held to a ratio: in fractions, width / height = ratio * frame height / frame width.
  const shape = (ratio * frame.height) / Math.max(1, frame.width);
  const horizontal = handle.includes("e") || handle.includes("w");
  const vertical = handle.includes("n") || handle.includes("s");
  let width = right - left;
  let height = bottom - top;
  if (horizontal && vertical) {
    // A corner follows whichever side moved further, and keeps the opposite corner still.
    if (width / shape >= height) height = width / shape;
    else width = height * shape;
  } else if (horizontal) height = width / shape;
  else width = height * shape;

  // The still point: the opposite corner, or the middle of the opposite edge, and the room the
  // crop has from it to the image's edge.
  const west = handle.includes("w");
  const east = handle.includes("e");
  const north = handle.includes("n");
  const south = handle.includes("s");
  const middleX = start.x + start.width / 2;
  const middleY = start.y + start.height / 2;
  const anchorX = west ? right : east ? left : middleX;
  const anchorY = north ? bottom : south ? top : middleY;
  const roomX = west ? anchorX : east ? 1 - anchorX : 2 * Math.min(anchorX, 1 - anchorX);
  const roomY = north ? anchorY : south ? 1 - anchorY : 2 * Math.min(anchorY, 1 - anchorY);
  const fit = Math.min(1, roomX / width, roomY / height);
  width *= fit;
  height *= fit;
  const x = west ? anchorX - width : east ? anchorX : anchorX - width / 2;
  const y = north ? anchorY - height : south ? anchorY : anchorY - height / 2;
  return { x: clamp(x, 0, 1 - width), y: clamp(y, 0, 1 - height), width, height };
}

const handlePlace: Record<Exclude<Handle, "move">, string> = {
  nw: "-left-1 -top-1 cursor-nwse-resize",
  ne: "-right-1 -top-1 cursor-nesw-resize",
  sw: "-bottom-1 -left-1 cursor-nesw-resize",
  se: "-bottom-1 -right-1 cursor-nwse-resize",
  n: "-top-1 left-1/2 -translate-x-1/2 cursor-ns-resize",
  s: "-bottom-1 left-1/2 -translate-x-1/2 cursor-ns-resize",
  w: "-left-1 top-1/2 -translate-y-1/2 cursor-ew-resize",
  e: "-right-1 top-1/2 -translate-y-1/2 cursor-ew-resize",
};
const handleShape: Record<Exclude<Handle, "move">, string> = {
  nw: "size-4 border-l-4 border-t-4",
  ne: "size-4 border-r-4 border-t-4",
  sw: "size-4 border-b-4 border-l-4",
  se: "size-4 border-b-4 border-r-4",
  n: "h-1 w-6 bg-cream-bright",
  s: "h-1 w-6 bg-cream-bright",
  w: "h-6 w-1 bg-cream-bright",
  e: "h-6 w-1 bg-cream-bright",
};

/**
 * The crop drawn over an image: the kept part clear inside a bright edge, the rest dimmed, with
 * corner and edge handles to size it and the middle to move it. While it is dragged, thirds lines
 * show. Its parent is the image's own box (positioned, the image's size); the crop is in fractions
 * of it, so it holds its place as the image scales.
 *
 * Keyboard: the frame takes focus; arrows move it and Option+arrows size it from its bottom right
 * corner, Shift going ten times as far.
 *
 * ```tsx
 * <div className="relative" style={{ width, height }}>
 *   <canvas … />
 *   <ImageCropFrame rect={crop} ratio={3 / 2} onChange={setCrop} onCommit={remember} />
 * </div>
 * ```
 */
export function ImageCropFrame({
  rect,
  ratio = null,
  label = "Crop",
  onChange,
  onCommit,
}: {
  rect: CropRect;
  /** Width over height, in the image's pixels, to hold the crop to; null for free. */
  ratio?: number | null;
  label?: string;
  /** Every step of a drag or a key press. */
  onChange: (rect: CropRect) => void;
  /** Once a drag ends or a key is let go, with the crop it ended on. */
  onCommit?: (rect: CropRect) => void;
}) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<{
    handle: Handle;
    startX: number;
    startY: number;
    start: CropRect;
    last: CropRect;
  } | null>(null);
  const [dragging, setDragging] = React.useState(false);

  const frame = () => {
    const box = rootRef.current?.getBoundingClientRect();
    return { width: box?.width || 1, height: box?.height || 1 };
  };

  const begin = (handle: Handle) => (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { handle, startX: event.clientX, startY: event.clientY, start: rect, last: rect };
    setDragging(true);
  };
  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    const size = frame();
    const next = dragCrop(
      current.start,
      current.handle,
      (event.clientX - current.startX) / size.width,
      (event.clientY - current.startY) / size.height,
      size,
      ratio,
    );
    current.last = next;
    onChange(next);
  };
  const end = () => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    setDragging(false);
    onCommit?.(current.last);
  };

  const keyed = React.useRef<CropRect | null>(null);
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    const size = frame();
    const amount = event.shiftKey ? keyStepPx * 10 : keyStepPx;
    const next = dragCrop(
      rect,
      event.altKey ? "se" : "move",
      (step[0] * amount) / size.width,
      (step[1] * amount) / size.height,
      size,
      ratio,
    );
    keyed.current = next;
    onChange(next);
  };
  const onKeyUp = () => {
    if (keyed.current) onCommit?.(keyed.current);
    keyed.current = null;
  };

  return (
    <div
      ref={rootRef}
      data-slot="image-crop-frame"
      // Clipped to the image, so the dimming stays on it.
      className="absolute inset-0 touch-none select-none overflow-hidden"
    >
      <div
        role="group"
        aria-label={label}
        aria-roledescription="crop frame"
        tabIndex={0}
        data-dragging={dragging || undefined}
        className={cn(
          "absolute cursor-move border border-cream-bright/90 outline-none",
          // Everything outside the crop dims, from one shadow as wide as any image.
          "shadow-[0_0_0_100vmax_rgb(0_0_0/55%)]",
          "focus-visible:border-cream-bright",
        )}
        style={{
          left: `${rect.x * 100}%`,
          top: `${rect.y * 100}%`,
          width: `${rect.width * 100}%`,
          height: `${rect.height * 100}%`,
        }}
        onPointerDown={begin("move")}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
      >
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3 transition-opacity",
            dragging ? "opacity-100" : "opacity-0",
          )}
        >
          {Array.from({ length: 9 }, (_, cell) => (
            <div
              key={cell}
              className={cn(
                "border-cream-bright/40",
                cell % 3 !== 2 && "border-r",
                cell < 6 && "border-b",
              )}
            />
          ))}
        </div>
        {(Object.keys(handlePlace) as Exclude<Handle, "move">[]).map((handle) => (
          <div
            key={handle}
            aria-hidden="true"
            className={cn(
              "absolute flex items-center justify-center p-1",
              handlePlace[handle],
            )}
            // Its moves and release bubble to the frame, which follows the drag.
            onPointerDown={begin(handle)}
          >
            <span className={cn("block rounded-xs border-cream-bright", handleShape[handle])} />
          </div>
        ))}
      </div>
    </div>
  );
}
