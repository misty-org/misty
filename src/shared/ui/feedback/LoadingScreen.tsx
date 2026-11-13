import { useEffect, useSyncExternalStore } from "react";
import { cn } from "../classNames";
import { QuietPane } from "./QuietPane";
import { Skeleton, SkeletonList } from "./Skeleton";

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
 * splash: the same view as an empty pane (`QuietPane`), Misty flying behind its line, never
 * loading text;
 * inline it is a skeleton. A full-screen one that is `leaving` fades out at once over what
 * replaced it, so a loaded app shows right away, then calls `onLeft`. */
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
  useEffect(() => {
    if (!fullScreen) return;
    splashChanged(1);
    return () => splashChanged(-1);
  }, [fullScreen]);
  return (
    <div
      className={cn(
        "h-full min-h-0 w-full flex-1 overflow-hidden bg-charcoal-bg",
        className,
        // The lowest named layer: over the app's content, still under its floating chrome.
        fullScreen && "fixed inset-0 layer-agent-surface grid place-items-center",
        leaving && "misty-loading-screen-leaving",
      )}
      role={fullScreen && !leaving ? "status" : undefined}
      aria-label={fullScreen && !leaving ? label : undefined}
      aria-hidden={leaving || undefined}
      onAnimationEnd={(event) => {
        if (leaving && event.target === event.currentTarget) onLeft?.();
      }}
    >
      {fullScreen ? (
        <QuietPane />
      ) : (
        <div className="mx-auto grid w-full max-w-2xl gap-6 px-6 py-10">
          <Skeleton className="h-6 w-1/3" />
          <SkeletonList label={label} rows={5} />
        </div>
      )}
    </div>
  );
}
