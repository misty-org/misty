import { spacesApi } from "@/api/spaces/api";
import { homeApi } from "@/api/home/api";
import type { SpaceAgendaEntry } from "@/api/spaces/dto/interfaces/plannerExpansionTypes";
import type { Space } from "@/api/spaces/dto/interfaces/types";
import { useAuth } from "@/features/auth";
import {
  SpaceAvatar,
  canOpenMistySpaceSection,
  rememberedJournalRoute,
  rememberedPlannerRoute,
  socialProviderPath,
  useSpacesStore,
} from "@/features/spaces";
import {
  WORKSPACE_TOOLS_META,
  WorkspaceAppIcon,
  isWorkspaceToolId,
  workspaceSurfaceFromRoute,
  useRecentToolsStore,
  useWorkspaceStore,
  type WorkspaceToolId,
} from "@/features/workspace";
import { cn } from "@/shared/ui";
import { ArrowRight, CalendarDays, Clock3, UsersRound } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import {
  activityStreak,
  cacheHomeActivity,
  contributionDates,
  dateKey,
  readHomeActivity,
  recordHomeActivity,
  type HomeActivity,
} from "./homeActivity";
import {
  firstName,
  formatAgendaTime,
  formatClockTime,
  formatLongDate,
  formatRelativeDate,
  greetingForDate,
} from "./homeFormat";

type StreakView = "week" | "overview";

const contributionWeeks = 40;
const contributionDays = contributionWeeks * 7;
const fallbackTools: WorkspaceToolId[] = ["journal", "planner", "social", "inbox", "files"];

export function HomeDashboard({ spaceId }: { spaceId: string }) {
  const { user } = useAuth();
  const spaces = useSpacesStore((state) => state.spaces);
  const recentTools = useRecentToolsStore((state) => state.recentTools);
  const hydrateRecentTools = useRecentToolsStore((state) => state.hydrateRecentTools);
  const [agenda, setAgenda] = useState<SpaceAgendaEntry[]>([]);
  const [agendaState, setAgendaState] = useState<"loading" | "ready" | "error">("loading");
  const [streakView, setStreakView] = useState<StreakView>("week");
  const [now] = useState(() => new Date());
  const [activity, setActivity] = useState<HomeActivity>(() =>
    readHomeActivity(user?.id ?? "", spaceId),
  );
  const space = spaces.find((candidate) => candidate.id === spaceId);
  const encodedSpaceId = encodeURIComponent(spaceId);
  const agendaPath = `/spaces/${encodedSpaceId}/planner/agenda/day`;

  const loadAgenda = useCallback(async () => {
    if (!space || space.permissions?.["tasks.view"] === false) {
      setAgenda([]);
      setAgendaState("ready");
      return;
    }
    setAgendaState("loading");
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    try {
      const snapshot = await spacesApi.agenda(spaceId, start.toISOString(), end.toISOString());
      setAgenda(
        snapshot.entries
          .filter((entry) => entry.status !== "completed")
          .sort((left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at))
          .slice(0, 4),
      );
      setAgendaState("ready");
    } catch {
      setAgenda([]);
      setAgendaState("error");
    }
  }, [space, spaceId]);

  useEffect(() => {
    void loadAgenda();
    const refresh = () => void loadAgenda();
    window.addEventListener("misty:refresh-focused-tool", refresh);
    return () => window.removeEventListener("misty:refresh-focused-tool", refresh);
  }, [loadAgenda]);

  useEffect(() => {
    const todayKey = dateKey(new Date());
    const sessionKey = `misty:home-activity-session:${user?.id ?? "guest"}:${spaceId}:${todayKey}`;
    let recordedThisSession = false;
    try {
      if (window.sessionStorage.getItem(sessionKey)) {
        recordedThisSession = true;
      } else {
        window.sessionStorage.setItem(sessionKey, "1");
      }
    } catch {
      // Session storage is only used to avoid double-counting a mounted dashboard.
    }
    let cancelled = false;
    const request = recordedThisSession
      ? homeApi.snapshot(spaceId)
      : homeApi.recordVisit(spaceId, todayKey);
    void request
      .then((snapshot) => {
        if (cancelled) return;
        setActivity(snapshot.activity);
        cacheHomeActivity(user?.id ?? "", spaceId, snapshot.activity);
        hydrateRecentTools(snapshot.recent_apps.filter(isWorkspaceToolId));
      })
      .catch(() => {
        if (cancelled || recordedThisSession) return;
        setActivity(recordHomeActivity(user?.id ?? "", spaceId, todayKey));
      });
    return () => {
      cancelled = true;
    };
  }, [hydrateRecentTools, spaceId, user?.id]);

  const jumpTools = useMemo(() => {
    const ordered = [...recentTools, ...fallbackTools];
    const seen = new Set<WorkspaceToolId>();
    return ordered
      .filter((toolId) => {
        if (seen.has(toolId) || toolId === "home" || toolId === "marketplace") return false;
        seen.add(toolId);
        if (!space) return !isSpaceTool(toolId);
        return !isSpaceTool(toolId) || canOpenMistySpaceSection(space, toolId);
      })
      .slice(0, 4);
  }, [recentTools, space]);

  const visibleSpaces = useMemo(
    () =>
      [...spaces]
        .sort((left, right) => {
          if (left.id === spaceId) return -1;
          if (right.id === spaceId) return 1;
          return Date.parse(right.updated_at) - Date.parse(left.updated_at);
        })
        .slice(0, 5),
    [spaceId, spaces],
  );

  const streak = activityStreak(activity, now);
  const weekDates = contributionDates(now, 7);
  const overviewDates = contributionDates(now, contributionDays);

  if (!space) return null;

  return (
    <main className="misty-transient-scrollbar h-full min-h-0 overflow-x-hidden overflow-y-auto bg-charcoal-bg text-cream selection:bg-avatar-yellow/25 selection:text-cream-bright [@media(min-width:1024px)_and_(min-height:800px)]:overflow-y-hidden">
      <div className="mx-auto w-full max-w-[1240px] px-5 py-6 sm:px-8 lg:px-10 [@media(min-width:1024px)_and_(min-height:800px)]:h-full">
        <header className="mb-6">
          <h1 className="text-balance text-[clamp(1.75rem,3vw,2.75rem)] font-semibold tracking-[-0.03em] text-cream-bright">
            {greetingForDate(now)}, {firstName(user?.name)}.
          </h1>
          <CurrentDateTime />
        </header>

        <div className="space-y-6">
          <section aria-labelledby="jump-back-in-title">
            <SectionHeading id="jump-back-in-title" title="Jump back in" />
            <div className="grid gap-2 rounded-2xl border border-charcoal-border bg-charcoal-card/55 p-2 sm:grid-cols-2 lg:grid-cols-4">
              {jumpTools.map((toolId) => {
                const route = routeForTool(toolId, space, user?.id ?? "");
                if (!route) return null;
                return (
                  <DashboardLink
                    key={toolId}
                    to={route}
                    className="group flex min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left outline-none transition-colors hover:bg-charcoal-active/65 focus-visible:ring-2 focus-visible:ring-sage-fg/60"
                  >
                    <WorkspaceAppIcon appId={toolId} size="marketplace" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-cream-bright">
                        {WORKSPACE_TOOLS_META[toolId].label}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-cream-muted">
                        {toolDescription(toolId)}
                      </span>
                    </span>
                    <ArrowRight
                      className="size-4 shrink-0 text-cream-muted opacity-0 transition-opacity group-hover:opacity-100"
                      aria-hidden="true"
                    />
                  </DashboardLink>
                );
              })}
            </div>
          </section>

          <div className="grid auto-rows-fr gap-9 lg:grid-cols-2 lg:gap-8">
            <section className="flex min-w-0 flex-col" aria-labelledby="agenda-title">
              <SectionHeading
                id="agenda-title"
                title="Agenda"
                action={
                  <DashboardLink to={agendaPath} className={sectionLinkClass}>
                    Open agenda
                  </DashboardLink>
                }
              />
              <div className="min-h-0 flex-1 rounded-2xl border border-charcoal-border bg-charcoal-card/55 p-2">
                <AgendaRows state={agendaState} entries={agenda} onRetry={loadAgenda} />
              </div>
            </section>

            <section className="flex min-w-0 flex-col" aria-labelledby="your-spaces-title">
              <SectionHeading id="your-spaces-title" title="Your spaces" />
              <div className="grid min-h-0 flex-1 content-start gap-1 rounded-2xl border border-charcoal-border bg-charcoal-card/55 p-2">
                {visibleSpaces.map((candidate) => (
                  <SpaceRow
                    key={candidate.id}
                    space={candidate}
                    current={candidate.id === spaceId}
                  />
                ))}
              </div>
            </section>
          </div>

          <section aria-labelledby="home-streak-title">
            <div className="mb-3 flex min-h-7 flex-wrap items-center justify-between gap-3 px-1">
              <div className="flex items-center gap-2.5">
                <StreakFlame />
                <h2
                  id="home-streak-title"
                  className="text-base font-semibold tracking-[-0.01em] text-cream-bright"
                >
                  {streak > 0 ? `${streak}-day streak` : "Start your streak"}
                </h2>
              </div>
              <div
                className="inline-flex rounded-lg border border-charcoal-border bg-charcoal-card p-0.5"
                aria-label="Streak view"
              >
                {(["week", "overview"] as const).map((view) => (
                  <button
                    key={view}
                    type="button"
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs font-medium capitalize outline-none transition-colors",
                      "focus-visible:ring-2 focus-visible:ring-avatar-yellow/70",
                      streakView === view
                        ? "bg-charcoal-active text-cream-bright"
                        : "text-cream-muted hover:text-cream",
                    )}
                    aria-pressed={streakView === view}
                    onClick={() => setStreakView(view)}
                  >
                    {view}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-charcoal-border bg-charcoal-card/65 px-3 py-2.5 sm:px-4">
              {streakView === "week" ? (
                <WeekContributions dates={weekDates} activity={activity} today={now} />
              ) : (
                <OverviewContributions dates={overviewDates} activity={activity} />
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function CurrentDateTime() {
  const [value, setValue] = useState(() => new Date());
  useEffect(() => {
    const updateClock = () => setValue(new Date());
    const interval = window.setInterval(updateClock, 1_000);
    return () => window.clearInterval(interval);
  }, []);

  const date = formatLongDate(value);
  const time = formatClockTime(value);
  return (
    <time
      className="mt-3 inline-flex max-w-full items-center gap-2.5 text-sm text-cream-bright"
      role="timer"
      aria-label={`Current date and time: ${date} at ${time}`}
      dateTime={value.toISOString()}
    >
      <span className="truncate">{date}</span>
      <span aria-hidden="true">/</span>
      <span className="shrink-0 font-medium tabular-nums">{time}</span>
    </time>
  );
}

function StreakFlame() {
  return (
    <svg className="size-5 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        fill="#ef7340"
        d="M12.9 1.9c.4 3.2-.7 4.7-2 6.1-1.4 1.8-2.7 3.4-2.1 5.9-1.5-1-2.1-2.5-1.8-4.4-2 1.8-3 4-3 6.2 0 4 3.5 7.3 8 7.3s8-3.3 8-7.5c0-3.7-2.1-7.2-7.1-13.6Z"
      />
      <path
        fill="#f3a33f"
        d="M13.8 8.1c.2 2-.6 3-1.5 4.1-1 1.2-1.8 2.3-1.3 4-1-.7-1.5-1.7-1.3-2.9-1.3 1.2-1.9 2.6-1.9 4 0 2.6 1.9 4.6 4.4 4.6 2.7 0 4.8-2.1 4.8-4.8 0-2.5-1.1-4.9-3.2-9Z"
      />
      <path
        fill="#f5d77a"
        d="M13.2 14.2c.1 1-.4 1.6-.9 2.2-.6.7-1 1.3-.7 2.2-.6-.4-.8-.9-.7-1.6-.7.7-1 1.4-1 2.2 0 1.4 1 2.4 2.4 2.4 1.5 0 2.6-1.1 2.6-2.6 0-1.3-.5-2.6-1.7-4.8Z"
      />
    </svg>
  );
}

function SectionHeading(props: { id: string; title: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex min-h-7 items-center justify-between gap-4 px-1">
      <h2 id={props.id} className="text-base font-semibold tracking-[-0.01em] text-cream-bright">
        {props.title}
      </h2>
      {props.action}
    </div>
  );
}

function AgendaRows(props: {
  state: "loading" | "ready" | "error";
  entries: SpaceAgendaEntry[];
  onRetry: () => void | Promise<void>;
}) {
  if (props.state === "loading") {
    return (
      <div className="space-y-2 p-1" role="status" aria-label="Loading today’s agenda">
        {[0, 1, 2].map((item) => (
          <div key={item} className="h-14 animate-pulse rounded-xl bg-charcoal-active/45" />
        ))}
      </div>
    );
  }
  if (props.state === "error") {
    return (
      <div className="flex min-h-24 items-center justify-between gap-4 rounded-xl px-4 py-3">
        <div>
          <p className="text-sm font-medium text-cream">Today’s agenda couldn’t load.</p>
          <p className="mt-1 text-xs text-cream-muted">Check your connection and try again.</p>
        </div>
        <button
          type="button"
          className="rounded-lg bg-charcoal-active px-3 py-2 text-xs font-medium text-cream outline-none hover:text-cream-bright focus-visible:ring-2 focus-visible:ring-sage-fg/60"
          onClick={() => void props.onRetry()}
        >
          Try again
        </button>
      </div>
    );
  }
  if (!props.entries.length) {
    return (
      <div className="flex min-h-24 items-center gap-3 rounded-xl px-4 py-3">
        <span className="grid size-9 place-items-center rounded-xl bg-charcoal-bg text-avatar-green">
          <CalendarDays size={18} aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-medium text-cream">Your day is clear.</p>
          <p className="mt-1 text-xs text-cream-muted">Nothing is due or scheduled today.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="grid gap-1">
      {props.entries.map((entry) => (
        <div
          key={`${entry.kind}:${entry.id}`}
          className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-charcoal-active/45"
        >
          <span className={cn("size-2 shrink-0 rounded-full", agendaDotClass(entry.kind))} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-cream">{entry.title}</p>
            <p className="mt-0.5 truncate text-xs capitalize text-cream-muted">
              {entry.kind.replace("_", " ")}
            </p>
          </div>
          <span className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums text-cream-muted">
            <Clock3 size={13} aria-hidden="true" />
            {formatAgendaTime(entry.starts_at, entry.all_day)}
          </span>
        </div>
      ))}
    </div>
  );
}

function SpaceRow(props: { space: Space; current: boolean }) {
  const encodedId = encodeURIComponent(props.space.id);
  return (
    <DashboardLink
      to={`/spaces/${encodedId}/home`}
      className="group flex min-w-0 items-center gap-3 rounded-xl px-3 py-1 outline-none transition-colors hover:bg-charcoal-active/65 focus-visible:ring-2 focus-visible:ring-sage-fg/60"
      aria-current={props.current ? "page" : undefined}
    >
      <SpaceAvatar space={props.space} className="size-9" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-cream-bright">
          {props.space.name}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-cream-muted">
          <UsersRound size={12} aria-hidden="true" />
          {props.space.member_count} {props.space.member_count === 1 ? "member" : "members"}
          <span aria-hidden="true">·</span>
          {formatRelativeDate(props.space.updated_at)}
        </span>
      </span>
      <span className="shrink-0 text-xs text-cream-muted">
        {props.current ? "Current" : "Open"}
      </span>
    </DashboardLink>
  );
}

function WeekContributions(props: { dates: Date[]; activity: HomeActivity; today: Date }) {
  const todayKey = dateKey(props.today);
  return (
    <div className="grid grid-cols-7 gap-2 sm:gap-3" aria-label="This week’s Home activity">
      {props.dates.map((date) => {
        const key = dateKey(date);
        const count = props.activity[key] ?? 0;
        const active = count > 0;
        return (
          <div key={key} className="flex min-w-0 flex-col items-center gap-2">
            <span className="text-[10px] font-medium uppercase tracking-wide text-cream-muted">
              {new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date)}
            </span>
            <span
              className={cn(
                "grid aspect-square w-full max-w-12 place-items-center rounded-full text-xs font-semibold tabular-nums transition-colors",
                active ? "bg-[#ff7a3d] text-charcoal-bg" : "bg-charcoal-bg text-cream-muted",
                key === todayKey && !active && "ring-1 ring-[#ff7a3d]/70",
              )}
              title={`${count} ${count === 1 ? "visit" : "visits"} on ${date.toLocaleDateString()}`}
            >
              {date.getDate()}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function OverviewContributions(props: { dates: Date[]; activity: HomeActivity }) {
  return (
    <div className="min-w-0 pb-1 [container-type:inline-size]">
      <div className="min-w-0">
        <div
          className="mb-1.5 flex justify-between px-0.5 text-[10px] text-cream-muted"
          aria-hidden="true"
        >
          {monthLabels(props.dates).map((label) => (
            <span key={label.key}>{label.label}</span>
          ))}
        </div>
        <div
          className="grid min-w-0 grid-flow-col grid-rows-[repeat(7,auto)] auto-cols-fr place-items-center gap-[clamp(0.125rem,0.25cqw,0.25rem)]"
          aria-label={`${contributionWeeks} weeks of Home activity`}
        >
          {props.dates.map((date) => {
            const key = dateKey(date);
            const count = props.activity[key] ?? 0;
            return (
              <span
                key={key}
                className={cn(
                  "aspect-square w-full max-w-[clamp(1.125rem,1.4cqw,1.5rem)] rounded-[5px]",
                  contributionClass(count),
                )}
                title={`${count} ${count === 1 ? "visit" : "visits"} on ${date.toLocaleDateString()}`}
              />
            );
          })}
        </div>
        <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-cream-muted">
          <span>Less</span>
          {[0, 1, 2, 4].map((count) => (
            <span key={count} className={cn("size-2.5 rounded-[3px]", contributionClass(count))} />
          ))}
          <span>More</span>
        </div>
      </div>
    </div>
  );
}

function DashboardLink(props: ComponentProps<typeof Link>) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    props.onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const path = typeof props.to === "string" ? props.to : (props.to.pathname ?? "");
    const surface = workspaceSurfaceFromRoute(path);
    if (surface) useWorkspaceStore.getState().openSurface(surface);
  };
  return <Link {...props} onClick={handleClick} />;
}

const sectionLinkClass =
  "rounded-md px-1.5 py-1 text-xs font-medium text-sage-fg outline-none underline-offset-4 hover:text-cream-bright hover:underline focus-visible:ring-2 focus-visible:ring-sage-fg/60";

function routeForTool(toolId: WorkspaceToolId, space: Space, accountId: string): string | null {
  const encodedId = encodeURIComponent(space.id);
  if (toolId === "journal") return rememberedJournalRoute(accountId, space.id);
  if (toolId === "planner") return rememberedPlannerRoute(accountId, space.id);
  if (toolId === "social") return socialProviderPath(space.id, "misty");
  if (toolId === "library") return `/spaces/${encodedId}/library`;
  if (toolId === "home") return `/spaces/${encodedId}/home`;
  if (["inbox", "browser", "code", "files", "terminal", "agents", "transfers"].includes(toolId)) {
    return `/${toolId}`;
  }
  return null;
}

function isSpaceTool(toolId: WorkspaceToolId): boolean {
  return ["journal", "planner", "social", "library"].includes(toolId);
}

function toolDescription(toolId: WorkspaceToolId): string {
  const descriptions: Partial<Record<WorkspaceToolId, string>> = {
    journal: "Notes and drawings",
    planner: "Tasks and agenda",
    social: "Conversations",
    library: "Saved resources",
    inbox: "Messages and updates",
    files: "Local and connected files",
    browser: "Web workspace",
    code: "Projects and source",
    terminal: "Local command line",
    agents: "AI collaborators",
    transfers: "Recent transfers",
  };
  return descriptions[toolId] ?? "Open workspace";
}

function agendaDotClass(kind: SpaceAgendaEntry["kind"]): string {
  if (kind === "event") return "bg-avatar-blue";
  if (kind === "task") return "bg-avatar-green";
  if (kind === "goal") return "bg-agent-violet";
  if (kind === "milestone") return "bg-avatar-orange";
  return "bg-agent-indigo";
}

function contributionClass(count: number): string {
  if (count >= 4) return "bg-[#ff7a3d]";
  if (count >= 2) return "bg-[#c85c32]";
  if (count >= 1) return "bg-[#713b2b]";
  return "bg-charcoal-active/75";
}

function monthLabels(dates: Date[]): { key: string; label: string }[] {
  const labels: { key: string; label: string }[] = [];
  for (const date of dates) {
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    if (labels.some((label) => label.key === key)) continue;
    labels.push({
      key,
      label: new Intl.DateTimeFormat(undefined, { month: "short" }).format(date),
    });
  }
  return labels;
}
