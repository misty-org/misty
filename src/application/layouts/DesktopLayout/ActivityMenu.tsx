import { formatActivityBadge } from "@/features/activity/activityModel";
import { useActivityStore } from "@/features/activity/useActivityStore";
import { cn } from "@/shared/ui";
import { Bell } from "lucide-react";
import { openActivityPanel } from "@/features/activity/activityPanelState";

export function ActivityMenu(props: { className: string }) {
  const count = useActivityStore((state) => state.attentionCount);
  const unseen = useActivityStore((state) => state.hasUnseenHistory);
  return (
    <button
      type="button"
      className={cn(props.className, "relative")}
      title="Activity"
      aria-haspopup="dialog"
      onClick={() => openActivityPanel()}
      aria-label={
        count > 0
          ? `Activity, ${count} needing attention`
          : unseen
            ? "Activity, unseen updates"
            : "Activity"
      }
    >
      <Bell size={18} strokeWidth={1.75} />
      {count > 0 ? (
        <span className="absolute right-0.5 top-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-cream-bright px-1 text-[9px] font-bold leading-none text-charcoal-workspace ring-2 ring-charcoal-workspace">
          {formatActivityBadge(count)}
        </span>
      ) : unseen ? (
        <span
          data-testid="activity-history-dot"
          aria-hidden="true"
          className="absolute right-1 top-1 size-1.5 rounded-full bg-cream-bright ring-2 ring-charcoal-workspace"
        />
      ) : null}
    </button>
  );
}
