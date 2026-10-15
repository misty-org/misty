import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { memoryApi, type MemoryEvent } from "@/features/recall";
import { Button, CollectionHeading, CollectionPage, IconButton, Skeleton } from "@/shared/ui";
import { dayBounds, dayLabel, shiftDay, todayKey } from "./days";

const kindLabel: Record<MemoryEvent["kind"], string> = {
  page: "Read",
  voice: "Said",
  recording: "Recorded",
  note: "Wrote",
};

/** One day of Memory: what you read, said and recorded, and a summary on request. */
export function JournalDay(props: { filters: ReactNode }) {
  const [day, setDay] = useState(todayKey);
  const [events, setEvents] = useState<MemoryEvent[] | null>(null);
  const [summary, setSummary] = useState<{ day: string; text: string } | null>(null);
  const [problem, setProblem] = useState("");
  const [summarizing, setSummarizing] = useState(false);
  useEffect(() => {
    let current = true;
    setEvents(null);
    setProblem("");
    const { from, to } = dayBounds(day);
    memoryApi.events({ from, to, limit: 200 }).then(
      (result) => current && setEvents(result.events),
      () => current && (setEvents([]), setProblem("This day couldn't load.")),
    );
    return () => {
      current = false;
    };
  }, [day]);
  const summarize = async () => {
    setSummarizing(true);
    try {
      const result = await memoryApi.daySummary({
        date: day,
        time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setSummary({ day, text: result.markdown || "Nothing was remembered on this day." });
    } catch {
      setProblem("The summary couldn't be made. Try again.");
    } finally {
      setSummarizing(false);
    }
  };
  return (
    <CollectionPage>
      <CollectionHeading
        title="Journal"
        actions={
          <div className="flex items-center gap-1">
            <IconButton label="Previous day" onClick={() => setDay(shiftDay(day, -1))}>
              <ChevronLeft />
            </IconButton>
            <span className="min-w-28 text-center text-sm">{dayLabel(day)}</span>
            <IconButton
              label="Next day"
              disabled={day >= todayKey()}
              onClick={() => setDay(shiftDay(day, 1))}
            >
              <ChevronRight />
            </IconButton>
            <Button
              variant="ghost"
              className="px-3"
              disabled={summarizing || !events?.length}
              onClick={() => void summarize()}
            >
              <Sparkles /> Summarize
            </Button>
          </div>
        }
      />
      {props.filters}
      {problem && (
        <p role="alert" className="text-sm text-cream-muted">
          {problem}
        </p>
      )}
      {summarizing && (
        <div className="flex flex-col gap-2" aria-hidden>
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      )}
      {summary?.day === day && !summarizing && (
        <section
          aria-label="Summary"
          className="whitespace-pre-wrap rounded-lg border border-cream-border p-4 text-sm"
        >
          {summary.text}
        </section>
      )}
      {events === null ? (
        <div className="flex flex-col gap-3" aria-hidden>
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-10 w-full" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <p className="text-sm text-cream-muted">Nothing was remembered on this day.</p>
      ) : (
        <ol className="flex flex-col divide-y divide-cream-border">
          {[...events].reverse().map((event) => (
            <li key={event.id} className="flex items-baseline gap-3 py-2 text-sm">
              <time className="w-12 shrink-0 text-cream-muted" dateTime={event.occurred_at}>
                {new Date(event.occurred_at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
              <span className="w-16 shrink-0 text-xs text-cream-muted">
                {kindLabel[event.kind]}
              </span>
              {event.url ? (
                <a
                  href={event.url}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 truncate hover:underline"
                >
                  {event.title || event.url}
                </a>
              ) : (
                <span className="min-w-0 truncate">{event.title}</span>
              )}
              {event.site && (
                <span className="ml-auto shrink-0 text-xs text-cream-muted">{event.site}</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </CollectionPage>
  );
}
