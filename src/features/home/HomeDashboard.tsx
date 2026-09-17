import { officialAppRoute, useAppsStore } from "@/features/apps";
import { homeApi } from "@/api/home/api";
import type { SpaceAgendaEntry } from "@/api/spaces/dto/interfaces/plannerExpansionTypes";
import type { Space } from "@/api/spaces/dto/interfaces/types";
import { useAuth } from "@/features/auth";
import {
  SpaceAvatar,
  preferredDefaultSpace,
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
import { useMobileSurfaceChrome, useSurfacePresentation } from "@/shared/mobile";
import { ArrowRight, CalendarDays, Clock3, Flame, UsersRound } from "lucide-react";
import {
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

import { useHomeAgenda, type HomeAgendaEntry } from "./useHomeAgenda";

const contributionWeeks = 40;
const contributionDays = contributionWeeks * 7;
const fallbackTools: WorkspaceToolId[] = ["journal", "planner", "social", "inbox", "files"];

type HomeDashboardProps = { global: true; spaceId?: never } | { global?: false; spaceId: string };

export function HomeDashboard({ spaceId, global = false }: HomeDashboardProps) {
  const presentation = useSurfacePresentation();
  const mobile = presentation !== "desktop";
  const { user } = useAuth();
  const spaces = useSpacesStore((state) => state.spaces);
  const spacesLoading = useSpacesStore((state) => state.loading);
  const installations = useAppsStore((state) => state.installations);
  const installedApps = useMemo(
    () =>
      new Set(installations.filter((app) => app.state === "installed").map((app) => app.app_id)),
    [installations],
  );
  const recentTools = useRecentToolsStore((state) => state.recentTools);
  const hydrateRecentTools = useRecentToolsStore((state) => state.hydrateRecentTools);
  const [now] = useState(() => new Date());
  const activityScope = JSON.stringify([user?.id, spaceId]);
  const [activityResult, setActivityResult] = useState<{
    scope: string;
    activity: HomeActivity;
    state: "ready" | "error";
  } | null>(null);
  const [activityAttempt, setActivityAttempt] = useState(0);
  const activity = activityResult?.scope === activityScope ? activityResult.activity : {};
  const activityState = activityResult?.scope === activityScope ? activityResult.state : "loading";
  const space = spaces.find((candidate) => candidate.id === spaceId);
  const fallbackSpaceId = global ? preferredDefaultSpace(spaces)?.id : undefined;
  const agendaSpaces = useMemo(
    () =>
      (global ? spaces : space ? [space] : []).filter(
        (candidate) => candidate.permissions?.["tasks.view"] !== false,
      ),
    [global, spaces, space],
  );
  const agenda = useHomeAgenda(user?.id ?? "", agendaSpaces, spacesLoading);
  const agendaSpace = space ?? preferredDefaultSpace(agendaSpaces);
  const agendaPath = agendaSpace
    ? `/spaces/${encodeURIComponent(agendaSpace.id)}/planner/agenda/day`
    : undefined;

  useEffect(() => {
    const todayKey = dateKey(new Date());
    const sessionKey = `misty:home-activity-session:${user?.id ?? "guest"}:${spaceId ?? "global"}:${todayKey}`;
    let recordedThisSession = false;
    try {
      recordedThisSession = !!window.sessionStorage.getItem(sessionKey);
    } catch {
      // The server remains authoritative when session storage is unavailable.
    }
    let cancelled = false;
    setActivityResult(null);
    const request = recordedThisSession
      ? homeApi.snapshot(spaceId, fallbackSpaceId)
      : homeApi.recordVisit(spaceId, todayKey, fallbackSpaceId);
    void request
      .then((snapshot) => {
        if (cancelled) return;
        setActivityResult({ scope: activityScope, activity: snapshot.activity, state: "ready" });
        cacheHomeActivity(user?.id ?? "", spaceId ?? "global", snapshot.activity);
        try {
          window.sessionStorage.setItem(sessionKey, "1");
        } catch {
          // A successful database response does not depend on local storage.
        }
        hydrateRecentTools(snapshot.recent_apps.filter(isWorkspaceToolId));
      })
      .catch(() => {
        if (cancelled) return;
        setActivityResult({ scope: activityScope, activity: {}, state: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [activityAttempt, activityScope, fallbackSpaceId, hydrateRecentTools, spaceId, user?.id]);

  useEffect(() => {
    const refresh = () => setActivityAttempt((value) => value + 1);
    window.addEventListener("misty:refresh-focused-tool", refresh);
    return () => window.removeEventListener("misty:refresh-focused-tool", refresh);
  }, []);

  const jumpTools = useMemo(() => {
    const ordered = [...recentTools, ...fallbackTools];
    const seen = new Set<WorkspaceToolId>();
    return ordered
      .filter((toolId) => {
        if (seen.has(toolId) || toolId === "home" || toolId === "marketplace") return false;
        seen.add(toolId);
        if (!installedApps.has(toolId === "social" ? "chat" : toolId)) return false;
        if (global) return true;
        if (!space) return !isSpaceTool(toolId);
        return !isSpaceTool(toolId) || spaceToolIsAvailable(space, toolId);
      })
      .slice(0, 4);
  }, [recentTools, space, installedApps, global]);

  const visibleSpaces = useMemo(
    () =>
      [...spaces]
        .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))
        .slice(0, 5),
    [spaces],
  );

  const streak = activityStreak(activity, now);
  const overviewDates = contributionDates(now, contributionDays);
  useMobileSurfaceChrome({ title: global ? "Home" : space?.name || "Home", level: "root" });

  if (!global && !space) return null;

  return (
    <main className="misty-transient-scrollbar h-full min-h-0 overflow-x-hidden overflow-y-auto bg-charcoal-bg text-cream selection:bg-avatar-yellow/25 selection:text-cream-bright">
      <div
        className={cn(
          "mx-auto w-full max-w-[1240px] [@media(min-width:1024px)_and_(min-height:800px)]:h-full",
          mobile ? "px-4 py-4" : "px-5 py-6 sm:px-8 lg:px-10",
        )}
      >
        <header className="mb-6">
          <h1 className="text-balance text-[clamp(1.75rem,3vw,2.75rem)] font-semibold tracking-[-0.03em] text-cream-bright">
            {greetingForDate(now)}, {firstName(user?.name)}.
          </h1>
          <CurrentDateTime />
        </header>

        <div className="space-y-6">
          {jumpTools.length > 0 && (
            <section aria-labelledby="jump-back-in-title">
              <SectionHeading id="jump-back-in-title" title="Jump back in" />
              <div
                className={cn(
                  "grid gap-2 rounded-2xl border border-charcoal-border bg-charcoal-card/55 p-2",
                  mobile ? "grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-4",
                )}
              >
                {jumpTools.map((toolId) => {
                  const route = global
                    ? officialAppRoute(toolId)
                    : space
                      ? routeForTool(toolId, space, user?.id ?? "")
                      : null;
                  if (!route) return null;
                  return (
                    <DashboardLink
                      key={toolId}
                      to={route}
                      className="group flex min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left outline-none transition-colors hover:bg-charcoal-active/65 focus-visible:ring-2 focus-visible:ring-sage-fg/60"
                    >
                      <WorkspaceAppIcon
                        appId={toolId}
                        context={global ? "app" : "space"}
                        size="marketplace"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-cream-bright">
                          {global && toolId === "library"
                            ? "Storage"
                            : WORKSPACE_TOOLS_META[toolId].label}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-cream-muted">
                          {global && toolId === "library"
                            ? "Connected storage services"
                            : toolDescription(toolId)}
                        </span>
                      </span>
                      <ArrowRight
                        className={cn(
                          "size-4 shrink-0 text-cream-muted transition-opacity",
                          mobile ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                        )}
                        aria-hidden="true"
                      />
                    </DashboardLink>
                  );
                })}
              </div>
            </section>
          )}

          <div className="grid auto-rows-fr gap-9 lg:grid-cols-2 lg:gap-8">
            <section className="flex min-w-0 flex-col" aria-labelledby="agenda-title">
              <SectionHeading
                id="agenda-title"
                title="Agenda"
                action={
                  agendaPath ? (
                    <DashboardLink to={agendaPath} className={sectionLinkClass}>
                      Open agenda
                    </DashboardLink>
                  ) : undefined
                }
              />
              <div className="min-h-0 flex-1 rounded-2xl border border-charcoal-border bg-charcoal-card/55 p-2">
                <AgendaRows
                  state={agenda.state}
                  entries={agenda.entries}
                  onRetry={agenda.retry}
                  showSpace={global}
                />
              </div>
            </section>

            <section className="flex min-w-0 flex-col" aria-labelledby="your-spaces-title">
              <SectionHeading id="your-spaces-title" title="Your spaces" />
              <div className="grid min-h-0 flex-1 content-start gap-1 rounded-2xl border border-charcoal-border bg-charcoal-card/55 p-2">
                {!visibleSpaces.length && (
                  <div className="px-3 py-3 text-sm text-cream-muted">
                    {spacesLoading ? (
                      <p role="status">Loading your spaces…</p>
                    ) : (
                      <DashboardLink to="/spaces" className={sectionLinkClass}>
                        Create a Space
                      </DashboardLink>
                    )}
                  </div>
                )}
                {visibleSpaces.map((candidate) => (
                  <SpaceRow key={candidate.id} space={candidate} />
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
                  {activityState === "loading"
                    ? "Loading activity…"
                    : activityState === "error"
                      ? "Streak unavailable"
                      : streak > 0
                        ? `${streak}-day streak`
                        : "Start your streak"}
                </h2>
              </div>
              {activityState === "error" && (
                <button
                  type="button"
                  className="text-xs text-cream-muted hover:text-cream-bright"
                  onClick={() => setActivityAttempt((value) => value + 1)}
                >
                  Retry activity
                </button>
              )}
            </div>

            <div className="rounded-2xl border border-charcoal-border bg-charcoal-card/65 px-3 py-2.5 sm:px-4">
              <OverviewContributions dates={overviewDates} activity={activity} />
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function spaceToolIsAvailable(space: Space, toolId: WorkspaceToolId): boolean {
  if (toolId === "social") return space.permissions?.["messages.read"] !== false;
  if (toolId === "planner") return space.permissions?.["tasks.view"] !== false;
  if (toolId === "library") return space.permissions?.["library.view"] !== false;
  return true;
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
  return <Flame className="size-5 shrink-0 text-cream-bright" aria-hidden="true" />;
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
  entries: HomeAgendaEntry[];
  showSpace: boolean;
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
  const error =
    props.state === "error" ? (
      <div className="flex min-h-24 items-center justify-between gap-4 rounded-xl px-4 py-3">
        <div>
          <p className="text-sm font-medium text-cream">
            {props.entries.length
              ? "Some agenda items couldn’t load."
              : "Today’s agenda couldn’t load."}
          </p>
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
    ) : null;
  if (error && !props.entries.length) return error;
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
      {error}
      {props.entries.map((entry) => (
        <DashboardLink
          to={`/spaces/${encodeURIComponent(entry.spaceId)}/planner/agenda/day`}
          key={`${entry.spaceId}:${entry.kind}:${entry.id}`}
          className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-charcoal-active/45"
        >
          <span className={cn("size-2 shrink-0 rounded-full", agendaDotClass(entry.kind))} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-cream">{entry.title}</p>
            <p className="mt-0.5 truncate text-xs capitalize text-cream-muted">
              {props.showSpace ? `${entry.spaceName} · ` : ""}
              {entry.kind.replace("_", " ")}
            </p>
          </div>
          <span className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums text-cream-muted">
            <Clock3 size={13} aria-hidden="true" />
            {formatAgendaTime(entry.starts_at, entry.all_day)}
          </span>
        </DashboardLink>
      ))}
    </div>
  );
}

function SpaceRow(props: { space: Space }) {
  const encodedId = encodeURIComponent(props.space.id);
  return (
    <DashboardLink
      to={`/spaces/${encodedId}/home`}
      className="group flex min-w-0 items-center gap-3 rounded-xl px-3 py-1 outline-none transition-colors hover:bg-charcoal-active/65 focus-visible:ring-2 focus-visible:ring-sage-fg/60"
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
      <span className="shrink-0 text-xs text-cream-muted">Open</span>
    </DashboardLink>
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
  if (count >= 4) return "bg-cream-bright";
  if (count >= 2) return "bg-cream-bright/70";
  if (count >= 1) return "bg-cream-bright/40";
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
