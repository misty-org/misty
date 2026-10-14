import { useEffect, useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef } from "react";
import { cn } from "../utils";
import { useMarqueeGroup } from "./MarqueeGroup";

const overflowFadeClass = [
  "[mask-image:linear-gradient(to_right,black_calc(100%-18px),transparent)]",
  "[-webkit-mask-image:linear-gradient(to_right,black_calc(100%-18px),transparent)]",
].join(" ");

/** Sliding text fades at whichever edge still has text beyond it, and is crisp at its ends. */
const slidingFadeClass = [
  "[mask-image:linear-gradient(to_right,transparent,black_var(--marquee-fade-left),black_calc(100%-var(--marquee-fade-right)),transparent)]",
  "[-webkit-mask-image:linear-gradient(to_right,transparent,black_var(--marquee-fade-left),black_calc(100%-var(--marquee-fade-right)),transparent)]",
].join(" ");

/** Slow enough to read as it moves, in pixels per second. */
const marqueeSpeed = 24;
/** How long text rests at each end, in seconds. */
const marqueeRest = 1.6;
/** The fade at a text edge, in pixels, and how quickly it comes or goes, in seconds. */
const marqueeFade = 16;
const marqueeRamp = 0.35;

/**
 * One full rhythm for a line that slides `distance` while the group's longest slides `longest`:
 * rest, slide to the end, rest, slide back. Every line shares the cycle's length, so they start
 * and turn together; a shorter line finishes its slide sooner and waits.
 */
function marqueeKeyframes(distance: number, longest: number) {
  const slide = distance / marqueeSpeed;
  const full = longest / marqueeSpeed;
  const cycle = 2 * marqueeRest + 2 * full;
  const ramp = Math.min(marqueeRamp, slide / 2);
  const back = marqueeRest * 2 + full;
  const at = (seconds: number) => Math.min(1, seconds / cycle);
  const frame = (
    seconds: number,
    position: number,
    left: number,
    right: number,
  ): { x: Keyframe; fade: Keyframe } => ({
    x: { offset: at(seconds), transform: `translateX(${position === 0 ? 0 : -position}px)` },
    fade: {
      offset: at(seconds),
      "--marquee-fade-left": `${left}px`,
      "--marquee-fade-right": `${right}px`,
    },
  });
  const frames = [
    frame(0, 0, 0, marqueeFade),
    frame(marqueeRest, 0, 0, marqueeFade),
    frame(marqueeRest + ramp, (distance * ramp) / slide, marqueeFade, marqueeFade),
    frame(
      marqueeRest + slide - ramp,
      distance - (distance * ramp) / slide,
      marqueeFade,
      marqueeFade,
    ),
    frame(marqueeRest + slide, distance, marqueeFade, 0),
    frame(back, distance, marqueeFade, 0),
    frame(back + ramp, distance - (distance * ramp) / slide, marqueeFade, marqueeFade),
    frame(back + slide - ramp, (distance * ramp) / slide, marqueeFade, marqueeFade),
    frame(back + slide, 0, 0, marqueeFade),
    frame(cycle, 0, 0, marqueeFade),
  ];
  return {
    duration: cycle * 1000,
    slide: frames.map((item) => item.x),
    fade: frames.map((item) => item.fade),
  };
}

export function OverflowFadeText({
  className,
  children,
  marquee = false,
  ...props
}: ComponentPropsWithoutRef<"span"> & {
  /**
   * Text that does not fit slides slowly to its end and back, instead of fading out. Inside a
   * MarqueeGroup, every such line moves in step with the others.
   */
  marquee?: boolean;
}) {
  const textRef = useRef<HTMLSpanElement>(null);
  const slideRef = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [distance, setDistance] = useState(0);
  const [round, setRound] = useState(0);
  const group = useMarqueeGroup();
  const id = useRef(Symbol("marquee")).current;
  const sliding = marquee && isOverflowing && distance > 0;

  useLayoutEffect(() => {
    group?.set(id, sliding ? distance : 0);
    return () => group?.set(id, 0);
  }, [group, id, sliding, distance]);
  useEffect(() => group?.subscribe(() => setRound((value) => value + 1)), [group]);

  useLayoutEffect(() => {
    const outer = textRef.current;
    const inner = slideRef.current;
    if (!sliding || !outer || !inner || typeof inner.animate !== "function") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const { duration, slide, fade } = marqueeKeyframes(
      distance,
      Math.max(distance, group?.longest() ?? 0),
    );
    const timing = { duration, iterations: Infinity, easing: "linear", fill: "both" } as const;
    const animations = [inner.animate(slide, timing), outer.animate(fade, timing)];
    // Lines of a group count from the same moment, so they stay in step however they began.
    if (group) animations.forEach((animation) => (animation.startTime = group.epoch));
    return () => animations.forEach((animation) => animation.cancel());
  }, [sliding, distance, group, round, children]);

  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element) return;

    const update = () => {
      const nextIsOverflowing = element.scrollWidth > element.clientWidth + 1;
      setIsOverflowing((current) => (current === nextIsOverflowing ? current : nextIsOverflowing));
      const inner = slideRef.current;
      const nextDistance = inner ? Math.max(0, inner.offsetWidth - element.clientWidth) : 0;
      setDistance((current) => (current === nextDistance ? current : nextDistance));
    };

    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (observer) observer.observe(element);
    else window.addEventListener("resize", update);

    return () => {
      if (observer) observer.disconnect();
      else window.removeEventListener("resize", update);
    };
  }, [children]);

  return (
    <span
      {...props}
      ref={textRef}
      className={cn(
        className,
        isOverflowing && !marquee && overflowFadeClass,
        sliding && slidingFadeClass,
      )}
      data-text-overflowing={isOverflowing ? "true" : "false"}
    >
      {marquee ? (
        <span ref={slideRef} className="inline-block">
          {children}
        </span>
      ) : (
        children
      )}
    </span>
  );
}
