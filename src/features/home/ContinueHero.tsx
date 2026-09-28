import { Button, cn, IconButton } from "@/shared/ui";
import { ArrowLeft, ArrowRight, Play } from "lucide-react";
import { useState } from "react";
import { formatRelativeDate } from "./homeFormat";
import { resumeTab } from "./HomeItemIcon";
import { HomePagePreview } from "./HomePagePreview";
import type { ContinueItem } from "./useContinueItems";

import { useHomePreviewItems } from "./useHomePreviewItems";

/** The last few websites, one at a time, a single click from where they were left. */
export function ContinueHero(props: { items: ContinueItem[]; preparing?: boolean }) {
  const [index, setIndex] = useState(0);
  const items = useHomePreviewItems(props.items);
  const count = items.length;
  const current = Math.max(0, Math.min(index, count - 1));
  const item = items[current];

  if (!item) {
    return (
      <section
        aria-label="Continue where you left off"
        className="grid min-h-64 lg:min-h-0 place-items-center rounded-2xl border border-charcoal-border bg-charcoal-card/55 p-8 text-center"
      >
        <div>
          <p role="status" className="text-base font-semibold text-cream-bright">
            {props.preparing ? "Preparing page previews…" : "No page previews yet"}
          </p>
          <p className="mt-1 text-sm text-cream-muted">
            {props.preparing
              ? "Capturing your open websites."
              : "Visit a website in Browser, then return here to pick up where you left off."}
          </p>
        </div>
      </section>
    );
  }

  const step = (by: number) => setIndex((current + by + count) % count);
  return (
    <section
      aria-label="Continue where you left off"
      aria-roledescription="carousel"
      className="grid min-h-64 lg:min-h-0 grid-rows-[minmax(140px,1fr)_auto] overflow-hidden rounded-2xl border border-charcoal-border bg-charcoal-card/55"
    >
      <div className="relative min-h-0 overflow-hidden border-b border-charcoal-border bg-charcoal-bg">
        <HomePagePreview key={item.tab.id} item={item} />
        <Button
          type="button"
          variant="ghost"
          size="none"
          aria-label={`Resume ${item.tab.title || item.detail}`}
          onClick={() => resumeTab(item)}
          className="absolute inset-0 rounded-none border-0 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-cream-bright"
        />
      </div>
      <div className="flex min-w-0 flex-col p-4">
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-semibold tracking-[-0.02em] text-cream-bright">
              {item.tab.title || item.detail}
            </h2>
            <p className="mt-1 flex items-center gap-2 text-sm text-cream-muted">
              <span className="truncate">{item.detail}</span>
              <span aria-hidden="true">·</span>
              <span className="shrink-0">
                {formatRelativeDate(new Date(item.tab.lastFocusedAt).toISOString())}
              </span>
            </p>
          </div>
          <div className="shrink-0">
            <Button onClick={() => resumeTab(item)}>
              <Play className="size-3.5 fill-current" aria-hidden="true" />
              Resume
            </Button>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 border-t border-charcoal-border pt-2">
          <IconButton
            label="Previous website"
            shape="round"
            disabled={count < 2}
            onClick={() => step(-1)}
          >
            <ArrowLeft size={16} aria-hidden="true" />
          </IconButton>
          <div className="flex items-center gap-1.5" aria-hidden="true">
            {items.map((entry, position) => (
              <span
                key={entry.tab.id}
                className={cn(
                  "h-1.5 rounded-full transition-[width] duration-150",
                  position === current ? "w-5 bg-cream-bright" : "w-1.5 bg-cream-muted/40",
                )}
              />
            ))}
          </div>
          <IconButton
            label="Next website"
            shape="round"
            disabled={count < 2}
            onClick={() => step(1)}
          >
            <ArrowRight size={16} aria-hidden="true" />
          </IconButton>
          <span className="ml-auto text-xs tabular-nums text-cream-muted" aria-live="polite">
            {current + 1}/{count}
          </span>
        </div>
      </div>
    </section>
  );
}
