import type { SpaceAgendaEntry } from "@/api/spaces/dto/interfaces/plannerExpansionTypes";
import type { Space } from "@/api/spaces/dto/interfaces/types";
import { useAuth } from "@/features/auth";
import {
  preferredDefaultSpace,
  rememberedJournalRoute,
  rememberedPlannerRoute,
  socialProviderPath,
  SpaceAvatar,
  useSpacesStore,
} from "@/features/spaces";
import {
  useRecentToolsStore,
  WORKSPACE_TOOLS_META,
  WorkspaceAppIcon,
  type WorkspaceToolId,
} from "@/features/workspace";
import { Button, cn } from "@/shared/ui";
import { ArrowRight, CalendarDays, Clock3, Flame, UsersRound } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { activityStreak, contributionDates } from "./homeActivity";
import {
  firstName,
  formatAgendaTime,
  formatClockTime,
  formatLongDate,
  formatRelativeDate,
  greetingForDate,
} from "./homeFormat";
import { contributionDays, OverviewContributions } from "./HomeContributions";
import { HomeLink } from "./HomeLink";
import { useHomeActivity } from "./useHomeActivity";
import { useHomeAgenda, type HomeAgendaEntry } from "./useHomeAgenda";
const fallbackTools: WorkspaceToolId[] = ["journal", "planner", "social", "inbox", "files"];
type HomeDashboardProps =
  | {
      global: true;
      spaceId?: never;
    }
  | {
      global?: false;
      spaceId: string;
    };
export function HomeDashboard({ spaceId, global = false }: HomeDashboardProps) {
  const { user } = useAuth();
  const spaces = useSpacesStore((state) => state.spaces);
  const spacesLoading = useSpacesStore((state) => state.loading);
  const recentTools = useRecentToolsStore((state) => state.recentTools);
  const [now] = useState(() => new Date());
  const space = spaces.find((candidate) => candidate.id === spaceId);
  const fallbackSpaceId = global ? preferredDefaultSpace(spaces)?.id : undefined;
  const {
    activity,
    state: activityState,
    retry: retryActivity,
  } = useHomeActivity(user?.id, spaceId, fallbackSpaceId);
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
  const jumpTools = useMemo(() => {
    const ordered = [...recentTools, ...fallbackTools];
    const seen = new Set<WorkspaceToolId>();
    return ordered
      .filter((toolId) => {
        if (seen.has(toolId) || toolId === "home" || toolId === "marketplace") return false;
        seen.add(toolId);
        if (global)
          return !!(isSpaceTool(toolId)
            ? preferredDefaultSpace(spaces)
            : ["files", "browser", "agents"].includes(toolId));
        if (!space) return !isSpaceTool(toolId);
        return !isSpaceTool(toolId) || spaceToolIsAvailable(space, toolId);
      })
      .slice(0, 4);
  }, [recentTools, space, spaces, global]);
  const visibleSpaces = useMemo(
    () =>
      [...spaces]
        .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))
        .slice(0, 5),
    [spaces],
  );
  const streak = activityStreak(activity, now);
  const overviewDates = contributionDates(now, contributionDays);
  if (!global && !space) return null;
  return (
    <main
      className={cn(
        "misty-transient-scrollbar h-full min-h-0 overflow-x-hidden",
        "overflow-y-auto bg-charcoal-bg text-cream selection:bg-avatar-yellow/25",
        "selection:text-cream-bright",
      )}
    >
      <div
        className={cn(
          "mx-auto w-full max-w-[1240px] [@media(min-width:1024px)_and_(min-height:800px)]:h-full",
          "px-5 py-6 sm:px-8 lg:px-10",
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
                  "sm:grid-cols-2 lg:grid-cols-4",
                )}
              >
                {jumpTools.map((toolId) => {
                  const targetSpace = space ?? preferredDefaultSpace(spaces);
                  const route = targetSpace
                    ? routeForTool(toolId, targetSpace, user?.id ?? "")
                    : ["files", "browser", "agents"].includes(toolId)
                      ? `/${toolId}`
                      : null;
                  if (!route) return null;
                  return (
                    <HomeLink
                      key={toolId}
                      to={route}
                      className={cn(
                        "group flex min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left",
                        "outline-none transition-colors hover:bg-charcoal-active/65",
                        "focus-visible:ring-2 focus-visible:ring-sage-fg/60",
                      )}
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
                          "opacity-0 group-hover:opacity-100",
                        )}
                        aria-hidden="true"
                      />
                    </HomeLink>
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
                    <HomeLink to={agendaPath} className={sectionLinkClass}>
                      Open agenda
                    </HomeLink>
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
                      <HomeLink to="/spaces" className={sectionLinkClass}>
                        Create a Space
                      </HomeLink>
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
                <Button
                  variant="link"
                  size="none"
                  className="text-xs text-cream-muted hover:text-cream-bright"
                  onClick={retryActivity}
                >
                  Retry activity
                </Button>
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
        <Button size="sm" onClick={() => void props.onRetry()}>
          Try again
        </Button>
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
        <HomeLink
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
        </HomeLink>
      ))}
    </div>
  );
}
function SpaceRow(props: { space: Space }) {
  const encodedId = encodeURIComponent(props.space.id);
  return (
    <HomeLink
      to={`/spaces/${encodedId}/home`}
      className={cn(
        "group flex min-w-0 items-center gap-3 rounded-xl px-3 py-1 outline-none",
        "transition-colors hover:bg-charcoal-active/65 focus-visible:ring-2",
        "focus-visible:ring-sage-fg/60",
      )}
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
    </HomeLink>
  );
}
const sectionLinkClass = cn(
  "rounded-md px-1.5 py-1 text-xs font-medium text-sage-fg outline-none",
  "underline-offset-4 hover:text-cream-bright hover:underline",
  "focus-visible:ring-2 focus-visible:ring-sage-fg/60",
);
function routeForTool(toolId: WorkspaceToolId, space: Space, accountId: string): string | null {
  const encodedId = encodeURIComponent(space.id);
  if (toolId === "journal") return rememberedJournalRoute(accountId, space.id);
  if (toolId === "planner") return rememberedPlannerRoute(accountId, space.id);
  if (toolId === "social") return socialProviderPath(space.id, "misty");
  if (toolId === "library") return `/spaces/${encodedId}/library`;
  if (toolId === "home") return `/spaces/${encodedId}/home`;
  if (["inbox", "browser", "code", "files", "terminal", "agents"].includes(toolId)) {
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
