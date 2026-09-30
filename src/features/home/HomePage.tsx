import { useAuth } from "@/features/auth";
import { preferredDefaultSpace, useSpacesStore } from "@/features/spaces";
import { Button, cn } from "@/shared/ui";
import { Flame } from "lucide-react";
import { useMemo, useState } from "react";
import { ContinueHero } from "./ContinueHero";
import { activityStreak } from "./homeActivity";
import { FillContributions } from "./HomeContributions";
import { firstName, formatLongDate, greetingForDate } from "./homeFormat";
import { HomeRecent } from "./HomeRecent";
import { HomeScheduled } from "./HomeScheduled";
import { HomeToday } from "./HomeToday";
import { useContinueItems } from "./useContinueItems";
import { useHomeActivity } from "./useHomeActivity";
import { useHomeAgenda } from "./useHomeAgenda";

import { useHomePreviewItems } from "./useHomePreviewItems";
import { usePrepareHomePreviews } from "./usePrepareHomePreviews";
import { useWorkspaceViewFocused } from "@/features/workspace/WorkspaceViewRouteScope";

const heroCount = 4;

/**
 * Misty's front door: pick up the last workspaces, see what today holds across every
 * Space, and keep the daily streak going.
 */
export function HomePage() {
  const { user } = useAuth();
  const spaces = useSpacesStore((state) => state.spaces);
  const spacesLoading = useSpacesStore((state) => state.loading);
  const [now] = useState(() => new Date());
  const recent = useContinueItems();
  const active = useWorkspaceViewFocused();
  const preparingPreviews = usePrepareHomePreviews(recent, active, heroCount);
  const previews = useHomePreviewItems(recent, heroCount);
  const previewIds = new Set(previews.map((item) => item.tab.id));
  const agendaSpaces = useMemo(
    () => spaces.filter((space) => space.permissions?.["tasks.view"] !== false),
    [spaces],
  );
  const agenda = useHomeAgenda(user?.id ?? "", agendaSpaces, spacesLoading, 6);
  const activity = useHomeActivity(user?.id, undefined, preferredDefaultSpace(spaces)?.id);
  const streak = activityStreak(activity.activity, now);

  return (
    <main
      className={cn(
        "misty-transient-scrollbar h-full min-h-0 overflow-y-auto overflow-x-hidden",
        "bg-charcoal-bg text-cream",
      )}
    >
      {/* On wide windows everything fits one screen; long lists scroll inside their cards. */}
      <div
        className={cn(
          "mx-auto grid w-full max-w-[1320px] gap-4 px-5 py-5 sm:px-8",
          "lg:h-full lg:min-h-[600px] lg:grid-rows-[auto_minmax(0,1.1fr)_minmax(0,1fr)]",
        )}
      >
        <header>
          <h1 className="text-balance text-[clamp(1.5rem,2.2vw,2rem)] font-semibold tracking-[-0.03em] text-cream-bright">
            {greetingForDate(now)}, {firstName(user?.name)}.
          </h1>
          <p className="mt-0.5 text-sm text-cream-muted">{formatLongDate(now)}</p>
        </header>

        <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <ContinueHero items={previews} preparing={preparingPreviews} />
          <HomeToday
            state={agenda.state}
            entries={agenda.entries}
            onRetry={agenda.retry}
            footer={<HomeScheduled />}
          />
        </div>

        <div className="grid min-h-0 gap-4 lg:grid-cols-2">
          <HomeRecent items={recent.filter((item) => !previewIds.has(item.tab.id)).slice(0, 6)} />
          <section
            aria-labelledby="home-streak-title"
            className="flex min-h-0 flex-col rounded-2xl border border-charcoal-border bg-charcoal-card/55 px-4 py-3"
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2
                id="home-streak-title"
                className="flex items-center gap-2 text-sm font-semibold text-cream-bright"
              >
                <Flame size={16} aria-hidden="true" />
                {activity.state === "loading"
                  ? "Loading activity…"
                  : activity.state === "error"
                    ? "Streak unavailable"
                    : streak > 0
                      ? `${streak}-day streak`
                      : "Start your streak"}
              </h2>
              {activity.state === "error" ? (
                <Button variant="link" size="none" className="text-xs" onClick={activity.retry}>
                  Retry
                </Button>
              ) : null}
            </div>
            {/* Stacked on narrow windows the card has no height of its own to fill. */}
            <div className="min-h-40 flex-1 lg:min-h-0">
              <FillContributions now={now} activity={activity.activity} />
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
