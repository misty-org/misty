import { cn } from "../utils";
import { FlyingMisty } from "./FlyingMisty";
import { Skeleton, SkeletonList } from "./Skeleton";

/** Loading surface for initial loads and route transitions. A full-screen one that is `leaving`
 * stays over what replaced it while it fades out, then calls `onLeft`. */
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
  return (
    <div
      className={cn(
        "h-full min-h-0 w-full flex-1 overflow-hidden bg-charcoal-bg",
        className,
        fullScreen && "fixed inset-0 z-50 grid place-items-center",
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
        <div className="relative grid size-full place-items-center px-6 text-center">
          <FlyingMisty />
          <p className="relative z-10 m-0 text-base font-medium text-cream">
            A little quiet here...
          </p>
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
