import { openActivityPanel } from "./activityPanelState";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ActivityRow } from "./ActivityRow";
import { useActivityStore } from "./useActivityStore";
import { activityAccountKey } from "./activityState";
import { activityTargetHref } from "./activityNavigation";
import type { ActivityItem } from "./types";

export function ActivityFeed({
  items,
  narrowed = false,
  onOpen,
}: {
  items?: ActivityItem[];
  narrowed?: boolean;
  onOpen?: () => void;
}) {
  const navigate = useNavigate();
  const state = useActivityStore();
  const markChecked = state.markHistoryChecked;
  useEffect(() => {
    markChecked();
  }, [markChecked]);
  const shown = items ?? state.allItems;
  const muted = state.mutedSourcesByAccount[activityAccountKey(state)] ?? [];
  const open = (item: ActivityItem) => {
    const target = state.openItem(item.id);
    const href = target && activityTargetHref(target);
    if (href) {
      onOpen?.();
      if (href === "/activity" || href.startsWith("/activity?")) openActivityPanel(href);
      else navigate(href);
    }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {state.offline ? (
        <p
          role="status"
          className="m-0 rounded-md bg-charcoal-card mx-2 px-2 py-1 text-xs text-cream-muted"
        >
          Offline · Showing saved activity
        </p>
      ) : null}
      {state.error ? (
        <div role="status" className="flex items-center gap-2 px-4 py-2 text-sm text-cream-muted">
          <span>Activity couldn’t refresh. Your saved requests are still here.</span>
          <button type="button" className="min-h-11 underline" onClick={() => void state.refresh()}>
            Retry
          </button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 misty-transient-scrollbar overflow-y-auto overscroll-contain px-2 py-1">
        {shown.length ? (
          <ul className="m-0 grid list-none gap-2 p-0">
            {shown.map((item) => (
              <ActivityRow
                key={item.id}
                item={item}
                muted={muted}
                onOpen={() => open(item)}
                onRead={() => state.markRead(item.id)}
                onMute={state.setSourceMuted}
                onDismiss={() => state.dismissItem(item.id)}
              />
            ))}
          </ul>
        ) : (
          <div className="flex min-h-32 flex-col items-center justify-center px-4 py-6 text-center">
            <p className="m-0 text-sm font-medium text-cream-bright">
              {narrowed ? "No matching activity" : "No activity yet"}
            </p>
            <p className="mb-0 mt-2 text-xs leading-5 text-cream-muted">
              {narrowed
                ? "Choose another filter to see more activity."
                : "Updates and requests will appear here."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
