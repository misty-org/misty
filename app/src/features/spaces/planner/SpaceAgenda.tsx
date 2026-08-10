import { useAuth } from "@/features/auth";
import { useSpaceAgendaPreferences } from "@/features/spaces";
import { spacesApi } from "@/api/spaces/api";
import type { SpaceAgendaEntry } from "@/api/spaces/dto/interfaces/plannerExpansionTypes";
import type {
  GoogleCalendarChoice,
  SpaceCalendarEvent,
  SpaceCalendarSource,
  SpaceIntegration,
} from "@/api/spaces/dto/interfaces/types";
import { errorText } from "@/shared/lib/format";
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/ui";
import {
  CalendarCheck2,
  CalendarDays,
  CalendarPlus,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Minus,
  Plus,
  RefreshCcw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { CalendarSourceDrawer, SpaceTaskEventDrawer } from "./SpacePlannerViews";
import {
  AgendaMonthView,
  AgendaTimelineView,
  type AgendaZoomMinutes,
} from "./spaceAgenda/AgendaViews";
import { NewCalendarEventDialog } from "./spaceAgenda/NewCalendarEventDialog";
import {
  agendaRange,
  agendaTitle,
  dayKey,
  moveAnchor,
  type AgendaView,
} from "./spaceAgenda/agendaDates";

export function SpaceAgenda({
  spaceId,
  view,
  canManage,
  canManageIntegrations,
}: {
  spaceId: string;
  view: AgendaView;
  canManage: boolean;
  canManageIntegrations: boolean;
}) {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState(() => {
    const value = new URLSearchParams(location.search).get("date");
    return value ? new Date(`${value}T12:00:00`) : new Date();
  });
  const [entries, setEntries] = useState<SpaceAgendaEntry[]>([]);
  const [sources, setSources] = useState<SpaceCalendarSource[]>([]);
  const [integrations, setIntegrations] = useState<SpaceIntegration[]>([]);
  const [choices, setChoices] = useState<GoogleCalendarChoice[]>([]);
  const [selectedIntegration, setSelectedIntegration] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [eventOpen, setEventOpen] = useState<SpaceCalendarEvent>();
  const [createEventOpen, setCreateEventOpen] = useState(false);
  const [zoomMinutes, setZoomMinutes] = useState<AgendaZoomMinutes>(30);
  const { visibility, setVisibility } = useSpaceAgendaPreferences(user?.id ?? "", spaceId);
  const range = useMemo(() => agendaRange(anchor, view), [anchor, view]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [agenda, calendarSources, calendarIntegrations] = await Promise.all([
        spacesApi.agenda(spaceId, range.from.toISOString(), range.to.toISOString()),
        spacesApi.calendarSources(spaceId),
        spacesApi.integrations(spaceId),
      ]);
      setEntries(agenda.entries);
      setSources(calendarSources.sources);
      setIntegrations(
        calendarIntegrations.integrations.filter((item) => item.provider === "google"),
      );
      setError("");
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, spaceId]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const refresh = (event: Event) => {
      if ((event as CustomEvent<{ space_id?: string }>).detail?.space_id === spaceId) void load();
    };
    window.addEventListener("misty:space-coordination-event", refresh);
    window.addEventListener("misty:space-roadmap-event", refresh);
    return () => {
      window.removeEventListener("misty:space-coordination-event", refresh);
      window.removeEventListener("misty:space-roadmap-event", refresh);
    };
  }, [load, spaceId]);

  const visible = entries.filter((entry) =>
    entry.kind === "task"
      ? visibility.tasks
      : entry.kind === "goal" || entry.kind === "milestone" || entry.kind === "roadmap_node"
        ? visibility.roadmap
        : !entry.source_id || !visibility.hiddenSources.includes(entry.source_id),
  );
  const updateAnchor = (next: Date) => {
    setAnchor(next);
    const params = new URLSearchParams(location.search);
    params.set("date", dayKey(next));
    navigate({ pathname: location.pathname, search: `?${params}` }, { replace: true });
  };
  const updateView = (next: AgendaView) => {
    navigate({
      pathname: `/spaces/${encodeURIComponent(spaceId)}/planner/agenda/${next}`,
      search: location.search,
    });
  };
  const updateZoom = (direction: "in" | "out") => {
    const steps: AgendaZoomMinutes[] = [60, 30, 15];
    setZoomMinutes((current) => {
      const index = steps.indexOf(current);
      const next = Math.min(steps.length - 1, Math.max(0, index + (direction === "in" ? 1 : -1)));
      return steps[next];
    });
  };
  const openEntry = (entry: SpaceAgendaEntry) => {
    if (entry.task_id)
      navigate(
        `/spaces/${encodeURIComponent(spaceId)}/planner/tasks/board?task=${encodeURIComponent(entry.task_id)}`,
      );
    else if (entry.kind === "event")
      setEventOpen({
        id: entry.id.replace(/^event:/, ""),
        space_id: spaceId,
        source_id: entry.source_id ?? "",
        provider: entry.source_id === "misty" ? "misty" : "google",
        external_event_id: entry.external_event_id ?? "",
        fingerprint: "",
        title: entry.title,
        description: entry.description ?? "",
        location: entry.location ?? "",
        meeting_url: entry.meeting_url ?? "",
        organizer: {},
        starts_at: entry.starts_at,
        ends_at: entry.ends_at,
        all_day: entry.all_day,
        timezone: entry.timezone,
        status: entry.status === "tentative" ? "tentative" : "confirmed",
        created_at: entry.starts_at,
        updated_at: entry.starts_at,
      });
    else if (entry.roadmap_id) {
      const selection = new URLSearchParams(
        entry.roadmap_node_id
          ? { node: entry.roadmap_node_id }
          : entry.goal_id
            ? { goal: entry.goal_id }
            : { milestone: entry.milestone_id ?? "" },
      );
      navigate(
        `/spaces/${encodeURIComponent(spaceId)}/planner/roadmaps/${encodeURIComponent(
          entry.roadmap_id,
        )}?${selection}`,
      );
    }
  };

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    try {
      await action();
      setError("");
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-charcoal-bg">
      <header
        className={[
          "misty-transient-scrollbar flex min-h-11 flex-wrap items-center gap-2",
          "overflow-x-auto border-b border-charcoal-border bg-charcoal-bg px-3 py-1.5",
        ].join(" ")}
      >
        <h1 className="m-0 shrink-0 text-sm font-semibold">Agenda</h1>

        <div className="ml-auto flex min-w-max flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Previous range"
              onClick={() => updateAnchor(moveAnchor(anchor, view, -1))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  className="h-8 min-w-32 justify-between gap-2 px-2.5 text-xs font-medium"
                  aria-label="Choose calendar date"
                >
                  {agendaTitle(anchor, view)}
                  <ChevronDown className="size-3.5 text-cream-muted" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-3">
                <label className="grid gap-1.5 text-xs font-medium text-cream-muted">
                  Go to date
                  <Input
                    type="date"
                    className="h-9 bg-charcoal-bg text-sm text-cream"
                    value={dayKey(anchor)}
                    onChange={(event) => {
                      if (event.target.value)
                        updateAnchor(new Date(`${event.target.value}T12:00:00`));
                    }}
                  />
                </label>
              </PopoverContent>
            </Popover>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Next range"
              onClick={() => updateAnchor(moveAnchor(anchor, view, 1))}
            >
              <ChevronRight className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Go to today"
              title="Today"
              onClick={() => updateAnchor(new Date())}
            >
              <CalendarCheck2 className="size-4" />
            </Button>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-8 min-w-24 justify-between gap-1.5 px-2.5 text-xs font-medium"
                aria-label="Calendar view"
              >
                <CalendarDays className="size-3.5" />
                {view[0].toUpperCase() + view.slice(1)}
                <ChevronDown className="size-3.5 text-cream-muted" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(["month", "week", "day"] as const).map((option) => (
                <DropdownMenuItem
                  key={option}
                  className={view === option ? "bg-charcoal-hover text-cream" : undefined}
                  onSelect={() => updateView(option)}
                >
                  {option[0].toUpperCase() + option.slice(1)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="ghost"
            className="h-8 gap-1.5 px-2.5 text-xs font-medium"
            onClick={() => setDrawerOpen(true)}
          >
            <CalendarPlus className="size-3.5" />
            Calendars
          </Button>

          {view !== "month" ? (
            <div
              className="flex h-8 items-center overflow-hidden rounded-md border border-charcoal-border/70"
              aria-label="Calendar time interval"
            >
              <Button
                variant="ghost"
                size="icon"
                className="size-8 rounded-none border-r border-charcoal-border/60"
                aria-label="Zoom out calendar"
                disabled={zoomMinutes === 60}
                onClick={() => updateZoom("out")}
              >
                <Minus className="size-3.5" />
              </Button>
              <span className="min-w-14 px-2 text-center text-xs font-medium">
                {zoomMinutes} min
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 rounded-none border-l border-charcoal-border/60"
                aria-label="Zoom in calendar"
                disabled={zoomMinutes === 15}
                onClick={() => updateZoom("in")}
              >
                <Plus className="size-3.5" />
              </Button>
            </div>
          ) : null}

          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-cream-muted/70 shadow-none hover:text-cream"
            aria-label="Refresh calendar"
            onClick={() =>
              void run("sync", async () => {
                await spacesApi.syncCalendarTasks(spaceId);
                await load();
              })
            }
          >
            {loading ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <RefreshCcw className="size-4" />
            )}
          </Button>
          {canManage ? (
            <Button className="h-8 gap-1.5 text-xs" onClick={() => setCreateEventOpen(true)}>
              <Plus className="size-3.5" />
              New event
            </Button>
          ) : null}
        </div>
      </header>
      <main className="relative min-h-0 overflow-hidden" aria-label={`${view} agenda`}>
        {error ? (
          <div
            className={cn(
              "absolute inset-x-3 top-3 z-40 flex items-center justify-between rounded-md",
              "border border-charcoal-active/30 bg-charcoal-bg px-3 py-2 text-sm text-cream-bright",
              "shadow-md ",
            )}
          >
            <span>{error}</span>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        ) : null}
        {view === "month" ? (
          <AgendaMonthView anchor={anchor} entries={visible} onOpen={openEntry} />
        ) : (
          <AgendaTimelineView
            anchor={anchor}
            entries={visible}
            view={view}
            zoomMinutes={zoomMinutes}
            onOpen={openEntry}
            onZoom={updateZoom}
          />
        )}
      </main>
      {drawerOpen ? (
        <CalendarSourceDrawer
          integrations={integrations}
          selectedIntegration={selectedIntegration}
          choices={choices}
          sources={sources}
          visibility={visibility}
          onVisibilityChange={setVisibility}
          canManage={canManageIntegrations}
          connectionsUnavailable={false}
          busy={busy}
          onSelect={(id) => {
            setSelectedIntegration(id);
            setChoices([]);
            if (id)
              void run("calendars", async () =>
                setChoices((await spacesApi.googleCalendars(spaceId, id)).calendars),
              );
          }}
          onPublish={(choice) =>
            void run(choice.id, async () => {
              await spacesApi.publishGoogleCalendar(spaceId, selectedIntegration, choice);
              await load();
            })
          }
          onDisable={(source) =>
            void run(source.id, async () => {
              await spacesApi.disableCalendarSource(spaceId, source.id);
              await load();
            })
          }
          onClose={() => setDrawerOpen(false)}
        />
      ) : null}
      {eventOpen ? (
        <SpaceTaskEventDrawer
          event={eventOpen}
          source={sources.find((source) => source.id === eventOpen.source_id)}
          onClose={() => setEventOpen(undefined)}
        />
      ) : null}
      <NewCalendarEventDialog
        open={createEventOpen}
        anchor={anchor}
        busy={busy === "create-event"}
        onOpenChange={setCreateEventOpen}
        onCreate={(input) =>
          void run("create-event", async () => {
            await spacesApi.createCalendarEvent(spaceId, input);
            setCreateEventOpen(false);
            await load();
          })
        }
      />
    </div>
  );
}
