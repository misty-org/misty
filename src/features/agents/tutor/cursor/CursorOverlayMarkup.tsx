import { invoke } from "@tauri-apps/api/core";
import type { CSSProperties, RefObject } from "react";
import {
  cn,
  companionTints,
  Pressable,
  screenMarkClass,
  StateMark,
  ViewportLayer,
  type CompanionTint,
} from "@misty/ui";
import type { AgentProfile } from "@/shared/schemas";
import { agentCloudVariants } from "../../personal/agent_cloud_avatars";
import { AgentAvatar, AgentCloudImage } from "../../personal/AgentPicture";
import { normalizeCompanionSize } from "./companion_size";
import type { PresentedHandoff, Presentation } from "./protocol";

type CursorOverlayMarkupProps = {
  presentation: Presentation;
  marker: RefObject<HTMLDivElement | null>;
  focus: RefObject<HTMLDivElement | null>;
  sketch?: RefObject<HTMLDivElement | null>;
  trail?: RefObject<HTMLDivElement | null>;
  caption?: RefObject<HTMLDivElement | null>;
  group: RefObject<HTMLDivElement | null>;
  bubble: RefObject<HTMLDivElement | null>;
  meter: RefObject<HTMLDivElement | null>;
};

const bubbleClass = cn(
  "absolute top-[calc(var(--spacing)*4.5*var(--companion-scale,1))] w-max rounded-md px-2 py-1",
  "text-micro font-medium",
  screenMarkClass.fill,
);
function handoffLine({ agent, state }: PresentedHandoff) {
  if (state === "waiting") return `${agent.name} needs you`;
  if (state === "done") return `${agent.name} is done`;
  if (state === "failed") return `${agent.name} couldn't finish`;
  return `${agent.name} is on it`;
}

const centeredClass = cn(
  "absolute -translate-x-1/2 -translate-y-1/2 scale-[var(--companion-scale,1)] opacity-0",
  "transition-opacity duration-150 ease-[ease]",
  "group-data-[sprite]/companion:top-[calc(var(--spacing)*6*var(--companion-scale,1))]",
);
const besideSpriteClass = "group-data-[sprite]/companion:left-5";
const mistyCloud = agentCloudVariants[0];
if (typeof Image !== "undefined")
  for (const source of [mistyCloud.src, mistyCloud.poster]) new Image().src = source;

export function CursorOverlayMarkup({
  presentation,
  marker,
  focus,
  sketch,
  trail,
  caption,
  group,
  bubble,
  meter,
}: CursorOverlayMarkupProps) {
  return (
    <ViewportLayer
      layer="agent-surface"
      passthrough
      className="select-none"
      aria-hidden="true"
      style={
        presentation.tint && presentation.tint in companionTints && presentation.tint !== "white"
          ? ({
              "--companion-ink": companionTints[presentation.tint as CompanionTint],
            } as CSSProperties)
          : undefined
      }
    >
      <div ref={focus} className="pointer-events-none absolute inset-0" />
      <div ref={sketch} className="pointer-events-none absolute inset-0" />
      <div ref={trail} className="pointer-events-none absolute inset-0" />
      <div ref={caption} className={screenMarkClass.caption} data-hidden="" />
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
        data-phase={
          presentation.phase === "processing" && presentation.handoff
            ? "handoff"
            : presentation.phase
        }
        data-sprite={presentation.sprite === true ? "" : undefined}
        style={
          {
            "--companion-scale": normalizeCompanionSize(presentation.size) / 100,
          } as CSSProperties
        }
      >
        {presentation.sprite === true && (
          <Pressable
            aria-label={presentation.agent ? `Ask ${presentation.agent.name}` : "Ask Misty"}
            tabIndex={-1}
            className={cn(
              "cursor-misty absolute size-8 -translate-x-1/2 -translate-y-1/2",
              "scale-[var(--companion-scale,1)]",
              "pointer-events-none group-data-[on-misty]/companion:pointer-events-auto",
            )}
            onClick={() => void invoke("cursor_companion_ask_open").catch(() => undefined)}
          >
            <div
              className={cn(
                "flex size-full items-center justify-center",
                screenMarkClass.companion,
              )}
              data-phase={presentation.phase}
              data-wave={presentation.wave ? "" : undefined}
            >
              {presentation.agent ? (
                <AgentAvatar agent={presentation.agent as AgentProfile} size="sm" />
              ) : (
                <AgentCloudImage variant={mistyCloud} fill />
              )}
            </div>
          </Pressable>
        )}
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
                screenMarkClass.meter,
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
          viewBox="0 0 18 18"
        >
          <circle cx="9" cy="9" r="7" strokeWidth="2.5" className={screenMarkClass.spinnerTrack} />
          <circle
            cx="9"
            cy="9"
            r="7"
            pathLength="100"
            strokeWidth="2.5"
            strokeDasharray="28 72"
            className={screenMarkClass.spinnerArc}
          />
        </svg>
        <div
          ref={bubble}
          className={cn(
            "cursor-point-bubble left-2.5 opacity-0 transition-opacity duration-500 ease-out",
            besideSpriteClass,
            bubbleClass,
          )}
        />
        {presentation.hint && (
          <div
            className={cn(
              "cursor-hint-bubble left-2.5 opacity-0 transition-opacity duration-500 ease-out",
              besideSpriteClass,
              bubbleClass,
            )}
          >
            {presentation.hint.text}
          </div>
        )}
        {presentation.handoff && !presentation.point && !presentation.error && (
          <div
            className={cn(
              "cursor-handoff-bubble left-2.5 flex items-center gap-1",
              "animate-[misty-fade-in_0.25s_ease-out] motion-reduce:animate-none",
              besideSpriteClass,
              bubbleClass,
            )}
          >
            <AgentAvatar agent={presentation.handoff.agent as AgentProfile} compact />
            {handoffLine(presentation.handoff)}
            <StateMark kind={presentation.handoff.state} />
          </div>
        )}
        {presentation.error && !presentation.point && (
          <div className={cn("cursor-error-bubble left-0 max-w-72", bubbleClass)}>
            {presentation.error.includes("Speech failed:")
              ? "Speech unavailable"
              : presentation.error}
          </div>
        )}
      </div>
    </ViewportLayer>
  );
}
