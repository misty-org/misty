import { useId } from "react";

import { cn } from "./utils";

export const mistyRoadmapUrl = "https://mistysys.com/roadmap";

export function ComingSoonSurface({ className }: { className?: string; feature?: string }) {
  const titleId = useId();

  return (
    <section
      className={cn(
        "flex h-full min-h-0 w-full flex-col bg-charcoal-bg px-6 py-8 text-center",
        className,
      )}
      aria-labelledby={titleId}
    >
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <h1 id={titleId} className="text-sm font-semibold text-cream-bright">
          coming soon...
        </h1>
      </div>

      <a
        className={cn(
          "mx-auto text-xs text-cream-muted underline underline-offset-4 transition-colors",
          "hover:text-cream-bright focus-visible:rounded-sm focus-visible:outline-none",
          "focus-visible:ring-2 focus-visible:ring-charcoal-active",
        )}
        href={mistyRoadmapUrl}
        target="_blank"
        rel="noreferrer"
      >
        View the Misty roadmap
      </a>
    </section>
  );
}
