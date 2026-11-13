import type { FramePacingState } from "@/app/layouts/desktop-state";
import { Surface, Text } from "@/shared/ui";
import { useEffect, useState } from "react";
import { frameOverlayBaseClass, frameOverlayLevelEdge } from "./styles";

export function FramePacingOverlay(props: { enabled: boolean }) {
  const [state, setState] = useState<FramePacingState>({
    fps: 0,
    frameMs: 0,
    slowFramePercent: 0,
    level: "idle",
  });

  useEffect(() => {
    if (!props.enabled) return;

    let animationFrame = 0;
    let lastFrameAt = performance.now();
    let sampleStartedAt = lastFrameAt;
    let frameCount = 0;
    let slowFrameCount = 0;
    let totalFrameMs = 0;

    const tick = (now: number) => {
      const frameMs = now - lastFrameAt;
      lastFrameAt = now;

      if (frameCount > 0) {
        totalFrameMs += frameMs;
        if (frameMs > 34) slowFrameCount += 1;
      }
      frameCount += 1;

      const elapsedMs = now - sampleStartedAt;
      if (elapsedMs >= 600) {
        const measuredFrames = Math.max(1, frameCount - 1);
        const fps = Math.round((frameCount * 1000) / elapsedMs);
        const averageFrameMs = totalFrameMs / measuredFrames;
        const slowFramePercent = Math.round((slowFrameCount / measuredFrames) * 100);
        const level =
          fps < 45 || slowFramePercent > 25
            ? "heavy"
            : fps < 56 || slowFramePercent > 8
              ? "light"
              : "idle";

        setState((previous) => {
          if (
            previous.fps === fps &&
            Math.abs(previous.frameMs - averageFrameMs) < 0.1 &&
            previous.slowFramePercent === slowFramePercent &&
            previous.level === level
          ) {
            return previous;
          }
          return { fps, frameMs: averageFrameMs, slowFramePercent, level };
        });

        sampleStartedAt = now;
        frameCount = 0;
        slowFrameCount = 0;
        totalFrameMs = 0;
      }

      animationFrame = requestAnimationFrame(tick);
    };

    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [props.enabled]);

  if (!props.enabled) return null;

  const label = state.level === "idle" ? "Idle" : state.level === "light" ? "Light" : "Heavy";

  return (
    <Surface
      as="aside"
      tone="card"
      edge={frameOverlayLevelEdge[state.level]}
      radius="md"
      className={frameOverlayBaseClass}
      aria-label="Frame pacing overlay"
    >
      <Text bare as="strong" tone="default" className="col-span-full text-xs font-extrabold">
        {label}
      </Text>
      <Text bare tone="muted" className="whitespace-nowrap tabular-nums">
        {state.fps > 0 ? state.fps : "--"} FPS
      </Text>
      <Text bare tone="muted" className="whitespace-nowrap tabular-nums">
        {state.frameMs > 0 ? state.frameMs.toFixed(1) : "--"} ms
      </Text>
      <Text bare tone="muted" className="whitespace-nowrap tabular-nums">
        {state.slowFramePercent}% slow
      </Text>
    </Surface>
  );
}
