import * as React from "react";
import { cn } from "../classNames";
import { controlFrame } from "./controlFrame";
import { Pressable, type PressableProps } from "./Pressable";

/**
 * How a Segment looks: `track` sits in a SegmentTrack and the chosen one lifts out of it;
 * `outline` stands alone in a row of outlined choices and the chosen one fills.
 */
export type SegmentLook = "track" | "outline";

export type SegmentProps = Omit<PressableProps, "wash"> & {
  look?: SegmentLook;
  /** A square segment holding only its icon; give it an `aria-label`. */
  iconOnly?: boolean;
};

const lookClass: Record<SegmentLook, string> = {
  track: cn(
    controlFrame.md,
    "gap-1.5 px-3 text-meta font-medium",
    "aria-checked:bg-charcoal-hover aria-checked:shadow-[0_1px_2px_rgb(0_0_0/25%)]",
    "aria-selected:bg-charcoal-hover aria-selected:shadow-[0_1px_2px_rgb(0_0_0/25%)]",
  ),
  outline: cn(
    "h-7 gap-1 rounded-md border border-charcoal-border px-2.5 text-caption",
    "aria-checked:border-transparent aria-checked:bg-charcoal-hover",
    "aria-selected:border-transparent aria-selected:bg-charcoal-hover",
  ),
};

/**
 * One of a few choices that keeps the role its group gives it: a tab in a tablist, a radio in a
 * radiogroup, or a toggle. The chosen one (`aria-selected` or `aria-checked`) is filled and
 * bright; the rest are muted and brighten under the pointer. For a plain choice of one value out
 * of a few, ChoiceGroup is the one control; Segment is for a bar whose parts differ in kind, such
 * as the Studio's dock (modes as tabs, the camera as radios, sounds as a toggle).
 *
 * ```tsx
 * <SegmentTrack role="tablist" aria-label="Mode">
 *   <Segment role="tab" aria-selected={mode === "build"} onClick={…}><Hammer />Build</Segment>
 * </SegmentTrack>
 * ```
 */
export const Segment = React.forwardRef<HTMLButtonElement, SegmentProps>(
  ({ look = "track", iconOnly = false, className, ...props }, ref) => (
    <Pressable
      ref={ref}
      data-slot="segment"
      data-look={look}
      className={cn(
        "flex shrink-0 items-center justify-center whitespace-nowrap text-cream-muted",
        "hover:text-cream-bright focus-visible:text-cream-bright",
        "aria-checked:text-cream-bright aria-selected:text-cream-bright",
        lookClass[look],
        iconOnly && "w-8 px-0",
        className,
      )}
      {...props}
    />
  ),
);
Segment.displayName = "Segment";

/** The faint track a row of `track` Segments sits in. Give it the group's role and name. */
export function SegmentTrack({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="segment-track"
      className={cn("flex flex-none gap-0.5 rounded-xl bg-row-hover p-0.5", className)}
      {...props}
    />
  );
}
