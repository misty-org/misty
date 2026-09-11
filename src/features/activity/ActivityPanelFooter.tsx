import { useActivityStore } from "./useActivityStore";
import type { selectActivityView } from "./activityView";
export function ActivityPanelFooter({
  results,
}: {
  results: ReturnType<typeof selectActivityView>;
}) {
  const state = useActivityStore();
  const button =
    "min-h-9 rounded-md px-3 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-cream-bright disabled:opacity-40";
  return (
    <footer className="flex shrink-0 items-center justify-end gap-1 px-2 py-1.5">
      <button
        type="button"
        disabled={!results.clearableIds.length}
        title="Clear matching activity on this device; unresolved requests are kept"
        className={`${button} text-cream-muted hover:text-cream-bright`}
        onClick={() => state.clearHistory(results.clearableIds)}
      >
        {results.narrowed ? "Clear filtered" : "Clear all"}
      </button>
      <button
        type="button"
        disabled={!results.readableIds.length}
        title="Mark matching updates read; pending requests still need action"
        className={`${button} bg-cream-bright text-charcoal-bg`}
        onClick={() => void state.markAllRead(results.readableIds)}
      >
        {results.narrowed ? "Mark filtered read" : "Mark all read"}
      </button>
    </footer>
  );
}
