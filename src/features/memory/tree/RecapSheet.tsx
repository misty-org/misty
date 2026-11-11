import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { recallSettings } from "../recall";
import { useSettingsStore } from "@/features/settings";
import { openExternalLink } from "@/shared/platform/openExternalLink";
import { Button, cn, IconButton, Pressable, Skeleton } from "@/shared/ui";
import { dayTitle, leftOffPage, siteThreads, threadTime } from "./recapDay";
import { useMemoryTreeStore } from "./useMemoryTreeStore";
import { useRecapDay } from "./useRecapDay";

const threadRow =
  "flex min-h-11 w-full items-center justify-between gap-2.5 border-t border-charcoal-border " +
  "px-1 py-1.5 text-left text-sm text-cream hover:bg-charcoal-hover";

function RecapSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

function Rows({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col">
      <h3 className="m-0 pb-1.5 text-sm font-medium text-cream-bright">{title}</h3>
      {children}
    </section>
  );
}

/** What you did and where you left off, on one day, beside the tree. */
export function RecapSheet({
  spaceId,
  startDay,
  className,
  onClose,
}: {
  spaceId: string;
  startDay: string | null;
  className?: string;
  onClose: () => void;
}) {
  const memoryOn = useSettingsStore((s) => recallSettings(s.settings?.document).enabled);
  const search = useMemoryTreeStore((s) => s.search);
  const { recap, showDay } = useRecapDay(spaceId, startDay);
  const page = recap ? leftOffPage(recap.events) : undefined;
  const outline = recap?.recap?.outline;
  const threads = outline?.threads?.length
    ? outline.threads
    : recap
      ? siteThreads(recap.events)
      : [];

  return (
    <aside
      aria-label="Recap"
      className={cn(
        "flex h-full flex-col overflow-y-auto border-l border-charcoal-border bg-charcoal-sidebar",
        className,
      )}
    >
      <div className="sticky top-0 flex items-center justify-between gap-2 bg-charcoal-sidebar py-3 pr-3 pl-4">
        <div role="group" aria-label="Choose a day" className="flex gap-0.5">
          <IconButton
            label="Previous day"
            disabled={!recap?.previous}
            onClick={() => recap?.previous && showDay(recap.previous)}
          >
            <ChevronLeft />
          </IconButton>
          <IconButton
            label="Next day"
            disabled={!recap?.following}
            onClick={() => recap?.following && showDay(recap.following)}
          >
            <ChevronRight />
          </IconButton>
        </div>
        <IconButton label="Close recap" onClick={onClose}>
          <X />
        </IconButton>
      </div>

      <div className="flex flex-col gap-7 px-6 pt-1 pb-8">
        {recap === undefined && <RecapSkeleton />}
        {recap === null && memoryOn && (
          <p className="m-0 text-sm text-cream">Nothing to recap yet.</p>
        )}
        {recap === null && !memoryOn && (
          <div className="flex flex-col items-start gap-2">
            <p className="m-0 text-sm text-cream">
              Recaps read what Memory keeps, and Memory is off.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("misty:open-settings", { detail: { section: "recall" } }),
                )
              }
            >
              Open Memory settings
            </Button>
          </div>
        )}
        {recap && (
          <>
            <div className="flex flex-col gap-3">
              <h2 className="m-0 text-xl font-semibold tracking-tight text-cream-bright">
                {dayTitle(recap.day)}
              </h2>
              {recap.recap?.text && (
                <p className="m-0 text-md leading-6 whitespace-pre-wrap text-cream">
                  {recap.recap.text}
                </p>
              )}
            </div>

            {page?.url && (
              <section className="flex flex-col gap-2.5 rounded-2xl border border-charcoal-border bg-charcoal-card p-3.5">
                <h3 className="m-0 text-sm font-medium text-cream-bright">Where you left off</h3>
                <div className="flex items-center gap-2.5">
                  <span className="min-w-0 flex-1 truncate text-sm text-cream" title={page.url}>
                    {page.title || page.site || page.url}
                  </span>
                  <Button size="sm" onClick={() => void openExternalLink(page.url!)}>
                    Open
                  </Button>
                </div>
              </section>
            )}

            {threads.length > 0 && (
              <Rows title={outline?.threads?.length ? "What you did" : "Sites you read"}>
                {threads.map((thread) => (
                  <Pressable
                    key={thread.title}
                    className={threadRow}
                    onClick={() => void search(thread.title)}
                  >
                    <span className="min-w-0">{thread.title}</span>
                    <span className="shrink-0 text-cream-muted">{threadTime(thread)}</span>
                  </Pressable>
                ))}
              </Rows>
            )}

            {outline?.next && outline.next.length > 0 && (
              <Rows title="Next">
                {outline.next.map((item) => (
                  <p
                    key={item}
                    className="m-0 border-t border-charcoal-border px-1 py-3 text-sm text-cream"
                  >
                    {item}
                  </p>
                ))}
              </Rows>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
