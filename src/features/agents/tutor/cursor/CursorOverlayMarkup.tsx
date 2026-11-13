import type { CSSProperties, RefObject } from "react";
import { cn, screenMarkClass, ViewportLayer } from "@/shared/ui";
import { normalizeCompanionSize } from "./companionSize";
import type { Presentation } from "./protocol";

type CursorOverlayMarkupProps = {
  presentation: Presentation;
  marker: RefObject<HTMLDivElement | null>;
  focus: RefObject<HTMLDivElement | null>;
  sketch?: RefObject<HTMLDivElement | null>;
  group: RefObject<HTMLDivElement | null>;
  bubble: RefObject<HTMLDivElement | null>;
  meter: RefObject<HTMLDivElement | null>;
};

/** The bubble beside the companion: the point it names, or what needs attention. */
const bubbleClass = cn(
  "absolute top-[calc(var(--spacing)*4.5*var(--companion-scale,1))] w-max rounded-md px-2 py-1",
  "text-micro font-medium",
  screenMarkClass.fill,
);
/** The meter and the spinner sit centered on the companion's point, at its size. */
const centeredClass = cn(
  "absolute -translate-x-1/2 -translate-y-1/2 scale-[var(--companion-scale,1)] opacity-0",
  "transition-opacity duration-150 ease-[ease]",
);

export function CursorOverlayMarkup({
  presentation,
  marker,
  focus,
  sketch,
  group,
  bubble,
  meter,
}: CursorOverlayMarkupProps) {
  return (
    <ViewportLayer layer="agent-surface" passthrough className="select-none" aria-hidden="true">
      <div ref={focus} className="pointer-events-none absolute inset-0" />
      <div ref={sketch} className="pointer-events-none absolute inset-0" />
      <div
        ref={marker}
        className={cn(
          "cursor-point-marker absolute top-0 left-0 size-5.5 opacity-0",
          "transition-opacity duration-250 ease-[ease] motion-reduce:transition-none",
          screenMarkClass.target,
        )}
      />
      <div
        ref={group}
        className={cn(
          "cursor-group group/companion absolute top-0 left-0 size-0 opacity-0",
          "transition-opacity duration-400 ease-[ease] motion-reduce:transition-none",
        )}
        data-phase={presentation.phase}
        style={
          {
            "--companion-scale": normalizeCompanionSize(presentation.size) / 100,
          } as CSSProperties
        }
      >
        <div
          ref={meter}
          className={cn(
            centeredClass,
            "flex h-6 items-center gap-0.5 group-data-[phase=listening]/companion:opacity-100",
          )}
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className={cn(
                "block h-1 w-0.5 rounded-full transition-[height] duration-80 ease-linear",
                screenMarkClass.fill,
              )}
            />
          ))}
        </div>
        <svg
          className={cn(
            centeredClass,
            "size-4.5 animate-[spin_0.8s_linear_infinite] overflow-visible",
            "group-data-[phase=processing]/companion:opacity-100",
            screenMarkClass.halo,
          )}
          viewBox="-2 -2 18 18"
        >
          <defs>
            <mask
              id="cursor-processing-arc"
              maskUnits="userSpaceOnUse"
              x="-2"
              y="-2"
              width="18"
              height="18"
            >
              <circle
                cx="7"
                cy="7"
                r="7"
                pathLength="100"
                fill="none"
                stroke="white"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray="70 30"
                strokeDashoffset="-15"
              />
            </mask>
          </defs>
          <foreignObject x="-2" y="-2" width="18" height="18" mask="url(#cursor-processing-arc)">
            <div className={cn("size-full", screenMarkClass.sweep)} />
          </foreignObject>
        </svg>
        <div
          ref={bubble}
          className={cn(
            "cursor-point-bubble left-2.5 opacity-0 transition-opacity duration-500 ease-out",
            bubbleClass,
          )}
        />
        {presentation.error && !presentation.point && (
          <div className={cn("cursor-error-bubble left-0", bubbleClass)}>
            {presentation.error.includes("Speech failed:")
              ? "Speech unavailable"
              : "Companion needs attention"}
            <br />
            Open Agents to retry.
          </div>
        )}
      </div>
    </ViewportLayer>
  );
}
