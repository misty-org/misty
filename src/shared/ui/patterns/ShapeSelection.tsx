import type * as React from "react";
import { cn } from "../classNames";
import type { ItemTone } from "../icons/itemTones";

/** A handle on a selection: where it sits in its parent, in pixels, and the cursor it shows. */
export type SelectionHandle = {
  id: string;
  x: number;
  y: number;
  cursor: "nwse-resize" | "nesw-resize" | "ns-resize" | "ew-resize" | "move";
};

/** Someone else's selection takes their tone, the same as their pointer and avatar. */
const toneStroke: Record<ItemTone, string> = {
  blue: "stroke-tone-blue",
  red: "stroke-tone-red",
  green: "stroke-tone-green",
  orange: "stroke-tone-orange",
  violet: "stroke-tone-violet",
  pink: "stroke-tone-pink",
  amber: "stroke-tone-amber",
  teal: "stroke-tone-teal",
  sand: "stroke-tone-sand",
};

/** Half a handle's side, in pixels. */
const handleHalf = 4;

/**
 * The frame around shapes picked on a canvas (an image's marks): a bright outline along the
 * selection's edge, which may be turned with the canvas, and square handles to size it by.
 * `tone` draws someone else's selection in their color, with no handles; `dashed` is the box
 * being dragged out to pick shapes. It fills its positioned parent and takes the pointer only on
 * its handles.
 *
 * ```tsx
 * <div className="relative" style={{ width, height }}>
 *   <canvas … />
 *   <ShapeSelection outline={corners} handles={handles} onHandlePointerDown={startResize} />
 * </div>
 * ```
 */
export function ShapeSelection({
  outline,
  handles = [],
  tone,
  dashed = false,
  onHandlePointerDown,
}: {
  /** The selection's edge, as points in the parent's pixels. */
  outline: ReadonlyArray<{ x: number; y: number }>;
  handles?: ReadonlyArray<SelectionHandle>;
  tone?: ItemTone;
  dashed?: boolean;
  onHandlePointerDown?: (id: string, event: React.PointerEvent<SVGRectElement>) => void;
}) {
  const points = outline.map((point) => `${point.x},${point.y}`).join(" ");
  return (
    <svg
      aria-hidden="true"
      data-slot="shape-selection"
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
    >
      {outline.length > 1 ? (
        <polygon
          points={points}
          className={cn("fill-none", tone ? toneStroke[tone] : "stroke-cream-bright")}
          strokeWidth={tone ? 2 : 1}
          strokeDasharray={dashed ? "4 3" : undefined}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {tone
        ? null
        : handles.map((handle) => (
            <rect
              key={handle.id}
              x={handle.x - handleHalf}
              y={handle.y - handleHalf}
              width={handleHalf * 2}
              height={handleHalf * 2}
              rx={1.5}
              className="pointer-events-auto fill-charcoal-bg stroke-cream-bright"
              strokeWidth={1.5}
              style={{ cursor: handle.cursor }}
              onPointerDown={(event) => onHandlePointerDown?.(handle.id, event)}
            />
          ))}
    </svg>
  );
}
