import { compareActivityNewestFirst, formatActivityBadge } from "./activityModel";
import { activityTargetHref } from "./activityNavigation";
import { useActivityStore } from "./useActivityStore";
import { Bell, CheckCheck, CloudOff } from "lucide-react";
import { useMemo } from "react";
import { useMobileSurfaceChrome } from "@/shared/mobile";
import { useNavigate } from "react-router-dom";

export function ActivityPage() {
  const navigate = useNavigate();
  const items = useActivityStore((state) => state.allItems);
  const attentionCount = useActivityStore((state) => state.attentionCount);
  const offline = useActivityStore((state) => state.offline);
  const markAllRead = useActivityStore((state) => state.markAllRead);
  const openItem = useActivityStore((state) => state.openItem);
  const ordered = useMemo(() => [...items].sort(compareActivityNewestFirst), [items]);
  const chromeConfig = useMemo(
    () => ({
      title: "Activity",
      level: "root" as const,
      primaryAction: ordered.some((item) => !item.readAt)
        ? {
            id: "mark-activity-read",
            label: "Mark all read",
            icon: CheckCheck,
            onPress: () => void markAllRead(),
          }
        : undefined,
    }),
    [markAllRead, ordered],
  );
  useMobileSurfaceChrome(chromeConfig);

  return (
    <section className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col bg-charcoal-bg">
      <p className="min-h-11 shrink-0 border-b border-charcoal-border px-4 py-3 text-sm text-cream-muted">
        {attentionCount
          ? `${formatActivityBadge(attentionCount)} need attention`
          : "You're caught up"}
      </p>
      {offline ? (
        <p className="flex min-h-11 items-center gap-2 border-b border-charcoal-border bg-charcoal-card px-4 text-sm text-cream-muted">
          <CloudOff size={17} aria-hidden="true" />
          Showing saved activity while offline.
        </p>
      ) : null}
      <div className="misty-transient-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
        {ordered.length ? (
          <ul className="m-0 grid list-none gap-0 p-0">
            {ordered.map((item) => (
              <li key={item.id} className="border-b border-charcoal-border/70 last:border-b-0">
                <button
                  type="button"
                  className="grid min-h-16 w-full grid-cols-[24px_minmax(0,1fr)] gap-3 bg-transparent px-2 py-3 text-left active:bg-charcoal-card"
                  onClick={() => {
                    const target = openItem(item.id);
                    const href = target ? activityTargetHref(target) : null;
                    if (href) navigate(href);
                  }}
                >
                  <span className="relative grid size-6 place-items-center text-cream-muted">
                    <Bell size={18} aria-hidden="true" />
                    {!item.readAt ? (
                      <span className="absolute right-0 top-0 size-1.5 rounded-full bg-sage-fg" />
                    ) : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-medium text-cream-bright">
                      {item.title}
                    </span>
                    {item.body ? (
                      <span className="mt-0.5 line-clamp-2 block text-sm leading-5 text-cream-muted">
                        {item.body}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="grid h-full min-h-56 place-items-center px-8 text-center">
            <div>
              <Bell className="mx-auto mb-3 text-cream-muted" size={24} aria-hidden="true" />
              <h2 className="text-base font-medium text-cream-bright">Nothing new</h2>
              <p className="mt-1 text-sm leading-5 text-cream-muted">
                Mentions, approvals, task changes, and agent updates will appear here.
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
