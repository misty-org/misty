import { CalendarClock, Lightbulb, X } from "lucide-react";
import type { AiRecapRecord } from "./api";
import { useAiSurfaceStore } from "./store";
import type { AiSurfaceAdapter } from "./types";

export function isRecapSurface(surfaceId: string): surfaceId is AiRecapRecord["surface_id"] {
  return surfaceId === "global" || surfaceId === "home" || surfaceId === "activity";
}

export function isUnseenRecap(recap: AiRecapRecord) {
  if (!recap.last_result || !recap.last_run_at) return false;
  return !recap.last_seen_at || new Date(recap.last_run_at) > new Date(recap.last_seen_at);
}

export function AiRecapNudge({
  recap,
  onDismiss,
  onOpen,
}: {
  recap: AiRecapRecord;
  onDismiss: () => void;
  onOpen: () => void;
}) {
  return (
    <aside className="misty-ai-proactive-nudge" aria-label="New Misty briefing">
      <CalendarClock className="size-3.5 shrink-0 text-sage-fg" aria-hidden />
      <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen}>
        <span className="block text-xs font-medium text-cream">Your Misty briefing is ready</span>
        <span className="block truncate text-[10px] text-cream-muted">{recap.last_result}</span>
      </button>
      <button
        type="button"
        className="rounded p-0.5 text-cream-muted hover:text-cream"
        aria-label="Dismiss Misty briefing"
        onClick={onDismiss}
      >
        <X className="size-3" />
      </button>
    </aside>
  );
}

export function AiRecapCard({ recap }: { recap: AiRecapRecord }) {
  return (
    <section className="mb-4 rounded-xl border border-sage-fg/25 bg-sage-fg/5 p-3">
      <div className="flex items-center gap-2">
        <CalendarClock className="size-3.5 text-sage-fg" aria-hidden />
        <h3 className="m-0 text-xs font-semibold">Recurring briefing</h3>
        {recap.last_run_at ? (
          <time className="ml-auto text-[9px] text-cream-muted" dateTime={recap.last_run_at}>
            {new Date(recap.last_run_at).toLocaleString()}
          </time>
        ) : null}
      </div>
      <p className="mb-0 mt-2 whitespace-pre-wrap text-xs leading-relaxed text-cream">
        {recap.last_result}
      </p>
      {recap.last_citations.length ? (
        <div className="mt-3 flex flex-wrap gap-1">
          {recap.last_citations.map((citation) => (
            <a
              key={`${citation.kind}:${citation.id}`}
              href={citation.href}
              className="rounded-full border border-charcoal-border bg-charcoal-card px-2 py-1 text-[10px] text-cream-muted hover:text-cream"
            >
              {citation.title}
            </a>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function AiProactiveNudge({
  accountId,
  paneId,
  adapter,
  reason,
  onDismiss,
  onOpen,
  onSnooze,
}: {
  accountId: string;
  paneId: string;
  adapter: AiSurfaceAdapter;
  reason: string;
  onDismiss: () => void;
  onOpen: () => void;
  onSnooze: () => void;
}) {
  const setPrompt = useAiSurfaceStore((state) => state.setPrompt);
  const action = adapter.getSuggestedActions?.()[0];
  if (!action || !accountId) return null;
  return (
    <aside className="misty-ai-proactive-nudge" aria-label="Misty suggestion">
      <Lightbulb className="size-3.5 shrink-0 text-sage-fg" aria-hidden />
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={() => {
          setPrompt(accountId, paneId, action.prompt);
          onOpen();
        }}
      >
        <span className="block truncate text-xs font-medium text-cream hover:text-cream-bright">
          Review “{action.label}”
        </span>
        <span className="mt-0.5 block truncate text-[10px] text-cream-muted">{reason}</span>
      </button>
      <button
        type="button"
        className="rounded px-1.5 py-1 text-[10px] text-cream-muted hover:bg-charcoal-card hover:text-cream"
        onClick={onSnooze}
      >
        Snooze
      </button>
      <button
        type="button"
        className="rounded p-0.5 text-cream-muted hover:text-cream"
        aria-label="Dismiss Misty suggestion"
        onClick={onDismiss}
      >
        <X className="size-3" />
      </button>
    </aside>
  );
}
