import { useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef } from "react";
import { cn } from "../utils";

const overflowFadeClass = [
  "[mask-image:linear-gradient(to_right,black_calc(100%-18px),transparent)]",
  "[-webkit-mask-image:linear-gradient(to_right,black_calc(100%-18px),transparent)]",
].join(" ");

/** Slow enough to read as it moves, in pixels per second. */
const marqueeSpeed = 24;

export function OverflowFadeText({
  className,
  children,
  marquee = false,
  ...props
}: ComponentPropsWithoutRef<"span"> & {
  /** Text that does not fit slides slowly to its end and back, instead of fading out. */
  marquee?: boolean;
}) {
  const textRef = useRef<HTMLSpanElement>(null);
  const slideRef = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const sliding = marquee && isOverflowing;

  useLayoutEffect(() => {
    const outer = textRef.current;
    const inner = slideRef.current;
    if (!sliding || !outer || !inner || typeof inner.animate !== "function") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const distance = inner.offsetWidth - outer.clientWidth;
    if (distance <= 0) return;
    // Rests at each end, then slides the whole overhang: forward, then back.
    const animation = inner.animate(
      [
        { transform: "translateX(0)", offset: 0 },
        { transform: "translateX(0)", offset: 0.18 },
        { transform: `translateX(-${distance}px)`, offset: 0.82 },
        { transform: `translateX(-${distance}px)`, offset: 1 },
      ],
      {
        duration: ((distance / marqueeSpeed) * 1000) / 0.64,
        direction: "alternate",
        iterations: Infinity,
        easing: "linear",
      },
    );
    return () => animation.cancel();
  }, [sliding, children]);

  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element) return;

    const updateOverflow = () => {
      const nextIsOverflowing = element.scrollWidth > element.clientWidth + 1;
      setIsOverflowing((current) => (current === nextIsOverflowing ? current : nextIsOverflowing));
    };

    updateOverflow();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateOverflow);
    if (observer) observer.observe(element);
    else window.addEventListener("resize", updateOverflow);

    return () => {
      if (observer) observer.disconnect();
      else window.removeEventListener("resize", updateOverflow);
    };
  }, [children]);

  return (
    <span
      {...props}
      ref={textRef}
      className={cn(className, isOverflowing && !marquee && overflowFadeClass)}
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
