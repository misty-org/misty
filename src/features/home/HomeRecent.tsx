import { isPrivateBrowserView, useWorkspaceStore } from "@/features/workspace";
import { Pressable } from "@/shared/ui";
import { History, RotateCcw } from "lucide-react";
import { formatRelativeDate } from "./homeFormat";
import { HomeItemIcon, resumeTab } from "./HomeItemIcon";
import { describeTab, type ContinueItem } from "./useContinueItems";

/**
 * Everything else that was open recently: tabs beyond the Continue card, then tabs that
 * were closed, which reopen where they were.
 */
export function HomeRecent(props: { items: ContinueItem[] }) {
  const closedTabs = useWorkspaceStore((state) => state.closedItems);
  const closed = closedTabs
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !isPrivateBrowserView(entry.view))
    .slice(0, Math.max(0, 8 - props.items.length));

  const reopen = (index: number) => {
    const tab = useWorkspaceStore.getState().reopenClosedView(index);
    if (!tab) return;
    window.dispatchEvent(new Event("misty:workspace-projection-applied"));
  };

  return (
    <section
      aria-labelledby="home-recent-title"
      className="flex min-h-0 flex-col rounded-2xl border border-charcoal-border bg-charcoal-card/55 p-2"
    >
      <h2
        id="home-recent-title"
        className="flex items-center gap-2 px-3 pb-2 pt-2 text-xs font-medium text-cream-muted"
      >
        <History size={14} aria-hidden="true" />
        Recent
      </h2>
      {!props.items.length && !closed.length ? (
        <p className="px-3 pb-3 text-sm text-cream-muted">Your recent tabs will show up here.</p>
      ) : (
        <ul className="misty-transient-scrollbar grid min-h-0 content-start gap-0.5 overflow-y-auto">
          {props.items.map((item) => (
            <li key={item.tab.id}>
              <RecentRow
                item={item}
                when={formatRelativeDate(new Date(item.tab.lastFocusedAt).toISOString())}
                onOpen={() => resumeTab(item)}
              />
            </li>
          ))}
          {closed.map(({ entry, index }) => (
            <li key={`closed:${entry.view.id}`}>
              <RecentRow
                item={{ tab: entry.view, windowTitle: "", ...describeTab(entry.view) }}
                when="Closed"
                reopen
                onOpen={() => reopen(index)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RecentRow(props: {
  item: ContinueItem;
  when: string;
  reopen?: boolean;
  onOpen: () => void;
}) {
  return (
    <Pressable
      onClick={props.onOpen}
      className="group flex w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2 hover:bg-charcoal-active/45"
    >
      <HomeItemIcon item={props.item} size="md" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-cream-bright">
          {props.item.tab.title || props.item.detail}
        </span>
        <span className="mt-0.5 block truncate text-xs text-cream-muted">{props.item.detail}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-cream-muted">
        {props.reopen ? <RotateCcw size={12} aria-hidden="true" /> : null}
        {props.when}
      </span>
    </Pressable>
  );
}
