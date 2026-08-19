import {
  activityTargetHref,
  compareActivityNewestFirst,
  formatActivityBadge,
  useActivityStore,
  type ActivityItem,
} from "@/features/activity";
import { Popover, PopoverContent, PopoverTrigger, cn } from "@/shared/ui";
import { Bell } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

const maxItems = 20;

/**
 * The activity feed, as a popover off the navigator header.
 *
 * Activity has no route of its own, so this reads the same store the Home
 * dashboard's Important card uses and navigates through the shared target
 * resolver rather than owning any routing of its own.
 */
export function ActivityMenu(props: { className: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const items = useActivityStore((state) => state.allItems);
  const attentionCount = useActivityStore((state) => state.attentionCount);
  const markAllRead = useActivityStore((state) => state.markAllRead);
  const openItem = useActivityStore((state) => state.openItem);
  const recent = useMemo(
    () => [...items].sort(compareActivityNewestFirst).slice(0, maxItems),
    [items],
  );

  const open_ = (item: ActivityItem) => {
    const target = openItem(item.id);
    const href = target ? activityTargetHref(target) : null;
    setOpen(false);
    if (href) navigate(href);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(props.className, "relative")}
          aria-label={
            attentionCount > 0 ? `Activity, ${attentionCount} needing attention` : "Activity"
          }
          title="Activity"
        >
          <Bell size={18} strokeWidth={1.75} />
          {attentionCount > 0 ? (
            <span className="absolute right-0.5 top-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-notification-red px-1 text-[9px] font-bold leading-none text-cream-bright ring-2 ring-charcoal-workspace">
              {formatActivityBadge(attentionCount)}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={10} className="w-[320px] p-0">
        <div className="flex items-center justify-between border-b border-charcoal-border/60 px-3 py-2">
          <p className="m-0 text-sm font-medium text-cream-bright">Activity</p>
          {attentionCount > 0 ? (
            <button
              type="button"
              className="rounded border-0 bg-transparent p-0 text-[11px] text-cream-muted hover:text-cream-bright"
              onClick={() => void markAllRead()}
            >
              Mark all read
            </button>
          ) : null}
        </div>
        <div className="grid max-h-[380px] gap-0.5 overflow-y-auto p-1.5">
          {recent.length === 0 ? (
            <p className="m-0 px-2 py-6 text-center text-xs text-cream-faint">Nothing new.</p>
          ) : (
            recent.map((item) => (
              <button
                key={item.id}
                type="button"
                className="grid w-full gap-0.5 rounded-md border-0 bg-transparent px-2 py-2 text-left transition-colors hover:bg-charcoal-card"
                onClick={() => open_(item)}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  {!item.readAt ? (
                    <span
                      className="size-1.5 shrink-0 rounded-full bg-sage-fg"
                      aria-hidden="true"
                    />
                  ) : null}
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-sm",
                      item.readAt ? "text-cream-muted" : "text-cream-bright",
                    )}
                  >
                    {item.title}
                  </span>
                </span>
                {item.body ? (
                  <span className="truncate text-[11px] text-cream-faint">{item.body}</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
