import { useActivityStore } from "./useActivityStore";
import type { selectActivityView } from "./activityView";
import { Button } from "@/shared/ui";
export function ActivityPanelFooter({
  results,
}: {
  results: ReturnType<typeof selectActivityView>;
}) {
  const state = useActivityStore();
  return (
    <footer className="flex shrink-0 items-center justify-end gap-1 px-2 py-1.5">
      <Button
        variant="ghost"
        disabled={!results.clearableIds.length}
        title="Clear matching activity on this device; unresolved requests are kept"
        size="sm"
        className="text-cream-muted"
        onClick={() => state.clearHistory(results.clearableIds)}
      >
        {results.narrowed ? "Clear filtered" : "Clear all"}
      </Button>
      <Button
        variant="primary"
        size="sm"
        disabled={!results.readableIds.length}
        title="Mark matching updates read; pending requests still need action"
        onClick={() => void state.markAllRead(results.readableIds)}
      >
        {results.narrowed ? "Mark filtered read" : "Mark all read"}
      </Button>
    </footer>
  );
}
