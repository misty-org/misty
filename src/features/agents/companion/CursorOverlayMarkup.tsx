import sprite from "@/shared/assets/misty-cloud-expression-cycle.webp?inline";
import type { CSSProperties, RefObject } from "react";
import { normalizeCompanionSize } from "./companionSize";
import type { Presentation } from "./protocol";

export type CursorOverlayMarkupProps = {
  presentation: Presentation;
  marker: RefObject<HTMLDivElement | null>;
  focus: RefObject<HTMLDivElement | null>;
  sketch?: RefObject<HTMLDivElement | null>;
  group: RefObject<HTMLDivElement | null>;
  bubble: RefObject<HTMLDivElement | null>;
  meter: RefObject<HTMLDivElement | null>;
};

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
    <div className="cursor-overlay" aria-hidden="true">
      <div ref={focus} className="cursor-focus-layer" />
      <div ref={sketch} className="cursor-sketch-layer" />
      <div ref={marker} className="cursor-point-marker" />
      <div
        ref={group}
        className="cursor-group"
        data-phase={presentation.phase}
        style={
          {
            "--companion-scale": normalizeCompanionSize(presentation.size) / 100,
          } as CSSProperties
        }
      >
        <img className="cursor-sprite" src={sprite} alt="" />
        <div ref={meter} className="cursor-waveform">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} />
          ))}
        </div>
        <svg className="cursor-spinner" viewBox="-2 -2 18 18">
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
            <div className="cursor-spinner-gradient" />
          </foreignObject>
        </svg>
        <div ref={bubble} className="cursor-point-bubble" />
        {presentation.error && !presentation.point && (
          <div className="cursor-error-bubble">
            {presentation.error.includes("Speech failed:")
              ? "Speech unavailable"
              : "Companion needs attention"}
            <br />
            Open Agents to retry.
          </div>
        )}
      </div>
    </div>
  );
}
