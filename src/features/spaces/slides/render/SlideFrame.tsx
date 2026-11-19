import { useRef, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/shared/ui";
import { SLIDE_HEIGHT, SLIDE_WIDTH } from "../deck/layouts";
import { useElementSize } from "./renderHooks";

/**
 * A 16:9 frame that draws its children in the slide's fixed 1920×1080 space, scaled to the
 * frame's width, so a slide looks the same in a thumbnail, the stage and present mode.
 * `overlay` draws on top at screen size, given the scale (the editor's slot bar).
 */
export function SlideFrame(props: {
  children: ReactNode;
  background: string;
  overlay?: (scale: number) => ReactNode;
  className?: string;
  /** A width for the frame when its parent sizes it, else it fills its parent's width. */
  width?: number;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { width } = useElementSize(ref);
  const scale = width / SLIDE_WIDTH;
  const style: CSSProperties = { background: props.background };
  if (props.width !== undefined) style.width = `${props.width}px`;
  return (
    <div
      ref={ref}
      role={props.label ? "img" : undefined}
      aria-label={props.label}
      className={cn("relative aspect-video w-full overflow-hidden", props.className)}
      style={style}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: `${SLIDE_WIDTH}px`,
          height: `${SLIDE_HEIGHT}px`,
          transform: `scale(${scale})`,
          transformOrigin: "0 0",
          visibility: scale > 0 ? "visible" : "hidden",
        }}
      >
        {props.children}
      </div>
      {props.overlay && scale > 0 ? props.overlay(scale) : null}
    </div>
  );
}
