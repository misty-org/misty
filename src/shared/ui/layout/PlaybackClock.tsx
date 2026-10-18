import { useLayoutEffect, useRef, type ReactNode } from "react";

/**
 * A playback position that advances by itself. The position is a registered CSS number on this
 * element, animated linearly from where the page last said it was to the end, so the clock text
 * and the bar beneath it (both read `--playback-position`, see styles.css) move with the display,
 * with nothing ticking in script. Each new report, seek or pause starts the animation over.
 */
export function PlaybackClock({
  position,
  length,
  playing,
  className,
  children,
}: {
  /** Seconds in. */
  position: number;
  /** Seconds in all. */
  length: number;
  playing: boolean;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.setProperty("--playback-length", String(length));
    element.style.setProperty("--playback-position", String(position));
    if (!playing || position >= length || typeof element.animate !== "function") return;
    const animation = element.animate(
      [{ "--playback-position": position }, { "--playback-position": length }],
      { duration: (length - position) * 1000, easing: "linear", fill: "forwards" },
    );
    return () => animation.cancel();
  }, [position, length, playing]);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
