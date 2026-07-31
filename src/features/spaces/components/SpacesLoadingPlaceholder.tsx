import { useEffect, useState } from "react";
import { Button, Skeleton } from "@/ui";

export function SpacePageLoadingPlaceholder(props: { label?: string; onRetry?: () => void }) {
  const [retryVisible, setRetryVisible] = useState(false);

  useEffect(() => {
    if (!props.onRetry) {
      setRetryVisible(false);
      return;
    }
    const timeout = window.setTimeout(() => setRetryVisible(true), 1_500);
    return () => window.clearTimeout(timeout);
  }, [props.onRetry]);

  return (
    <div
      className="relative flex h-full min-h-0 flex-col overflow-hidden bg-background"
      aria-busy="true"
      role="status"
    >
      <span className="sr-only">{props.label ?? "Loading Space"}</span>

      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border/60 px-3">
        <Skeleton className="h-8 min-w-44 max-w-xl flex-1 rounded-md" />
        <div className="flex items-center gap-2">
          <Skeleton className="size-8 rounded-md" />
          <Skeleton className="h-8 w-20 rounded-md" />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden px-[clamp(20px,5vw,72px)] py-7">
        <div className="mx-auto grid max-w-5xl gap-7">
          <div className="grid gap-2.5">
            <Skeleton className="h-3 w-28 rounded-md" />
            <Skeleton className="h-4 w-[min(36rem,82%)] rounded-md" />
            <Skeleton className="h-4 w-[min(29rem,68%)] rounded-md" />
          </div>

          <div className="grid gap-6">
            {[0, 1, 2].map((index) => (
              <div className="grid grid-cols-[36px_minmax(0,1fr)] gap-3" key={index}>
                <Skeleton className="size-9 rounded-full" />
                <div className="grid gap-2 pt-0.5">
                  <Skeleton className="h-3.5 w-36 rounded-md" />
                  <Skeleton className={`h-3.5 rounded-md ${index === 1 ? "w-[72%]" : "w-[88%]"}`} />
                  {index !== 1 ? <Skeleton className="h-3.5 w-[56%] rounded-md" /> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-border/50 px-[clamp(20px,5vw,72px)] py-4">
        <div className="mx-auto max-w-5xl">
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
      </div>

      {retryVisible && props.onRetry ? (
        <div className="absolute inset-x-0 top-20 z-10 flex justify-center px-4">
          <div className="flex items-center gap-3 rounded-full border border-border/70 bg-background/95 py-1.5 pl-4 pr-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur">
            <span>Still getting things ready</span>
            <Button size="sm" variant="ghost" type="button" onClick={props.onRetry}>
              Try again
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function SpacesAppLoadingPlaceholder() {
  return (
    <div
      className={[
        "misty-spaces-workbench grid h-full min-h-0",
        "grid-cols-[var(--misty-spaces-rail-width)_minmax(0,1fr)]",
        "grid-rows-[minmax(0,1fr)_32px] overflow-hidden bg-background",
      ].join(" ")}
    >
      <aside className="col-start-1 row-start-1 flex min-h-0 flex-col overflow-hidden border-r border-sidebar-border/60 bg-sidebar px-3 pb-2 pt-3">
        <Skeleton className="h-10 rounded-md" />
        <div className="mt-5 grid gap-2">
          <Skeleton className="h-5 w-24 rounded-md" />
          <Skeleton className="h-10 rounded-md" />
          <Skeleton className="h-10 w-5/6 rounded-md" />
          <Skeleton className="h-10 w-4/5 rounded-md" />
        </div>
        <div className="mt-auto border-t border-sidebar-border/55 pt-3">
          <Skeleton className="h-9 rounded-md" />
        </div>
      </aside>

      <main className="col-start-2 row-start-1 grid min-h-0 min-w-0 grid-rows-[48px_minmax(0,1fr)] overflow-hidden">
        <header className="flex items-center gap-1 border-b border-border/60 px-3">
          {[72, 78, 88, 82].map((width) => (
            <Skeleton className="h-8 rounded-md" style={{ width }} key={width} />
          ))}
        </header>
        <div className="min-h-0">
          <SpacePageLoadingPlaceholder label="Switching Spaces account" />
        </div>
      </main>

      <footer className="col-span-full row-start-2 flex items-center border-t border-border/60 px-2">
        <Skeleton className="size-6 rounded-md" />
      </footer>
    </div>
  );
}
