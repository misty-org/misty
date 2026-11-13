import { useEffect, useState, useSyncExternalStore } from "react";
import { cn } from "../classNames";
import { FlyingMisty } from "./FlyingMisty";
import { Skeleton, SkeletonList } from "./Skeleton";

/** Longest a leaving splash waits for Misty to reach the end of her track: one splash pass. */
const LONGEST_WAIT_MS = 3_500;

const stillPreferred = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** How many full-screen splashes are on screen, counting one still fading out. */
let splashes = 0;
const splashListeners = new Set<() => void>();
const splashChanged = (by: number) => {
  splashes += by;
  for (const listener of splashListeners) listener();
};

/**
 * Whether the startup splash is on screen, from the moment it shows until it has faded away.
 * Anything that would pop up over the window (a tour, a prompt) waits for this to be false.
 */
export function useSplashShowing(): boolean {
  return useSyncExternalStore(
    (listener) => {
      splashListeners.add(listener);
      return () => splashListeners.delete(listener);
    },
    () => splashes > 0,
  );
}

/** Loading surface for initial loads and route transitions. Full screen it is the startup
 * splash: Misty flying along her track over the window color, with no loading text (AGENTS.md);
 * inline it is a skeleton. A full-screen one that is `leaving` lets Misty finish the pass she is
 * on, so she is never cut off mid-flight, then fades out over what replaced it and calls
 * `onLeft`. */
export function LoadingScreen({
  label = "Loading",
  className,
  fullScreen = false,
  leaving = false,
  onLeft,
}: {
  label?: string;
  className?: string;
  fullScreen?: boolean;
  leaving?: boolean;
  onLeft?: () => void;
}) {
  const [fading, setFading] = useState(false);
  useEffect(() => {
    if (!fullScreen) return;
    splashChanged(1);
    return () => splashChanged(-1);
  }, [fullScreen]);
  useEffect(() => {
    if (!leaving) {
      setFading(false);
      return;
    }
    // Without motion there is no pass to finish; a hidden window may never end one.
    if (stillPreferred()) {
      setFading(true);
      return;
    }
    const timer = window.setTimeout(() => setFading(true), LONGEST_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);
  return (
    <div
      className={cn(
        "h-full min-h-0 w-full flex-1 overflow-hidden bg-charcoal-bg",
        className,
        // The lowest named layer: over the app's content, still under its floating chrome.
        fullScreen && "fixed inset-0 layer-agent-surface grid place-items-center",
        fading && "misty-loading-screen-leaving",
      )}
      role={fullScreen && !leaving ? "status" : undefined}
      aria-label={fullScreen && !leaving ? label : undefined}
      aria-hidden={leaving || undefined}
      onAnimationEnd={(event) => {
        if (fading && event.target === event.currentTarget) onLeft?.();
      }}
    >
      {fullScreen ? (
        <div className="relative size-full">
          <FlyingMisty pace="splash" onPass={() => leaving && setFading(true)} />
        </div>
      ) : (
        <div className="mx-auto grid w-full max-w-2xl gap-6 px-6 py-10">
          <Skeleton className="h-6 w-1/3" />
          <SkeletonList label={label} rows={5} />
        </div>
      )}
    </div>
  );
}
