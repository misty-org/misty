import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Plus,
  RefreshCcw,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/features/auth/AuthContext";
import { errorText } from "@/lib/format";
import type {
  GoogleCalendarChoice,
  SpaceCalendarEvent,
  SpaceCalendarSource,
  SpaceIntegration,
} from "@/models/interfaces/features/spaces/types";
import type { SpaceAgendaEntry } from "@/models/interfaces/features/spaces/plannerExpansionTypes";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import { useSpaceAgendaPreferences } from "@/stores/spaces/useSpaceAgendaPreferences";
import { Button } from "@/ui";
import { SpaceViewModeToggle } from "./components/SpaceViewModeToggle";
import { CalendarSourceDrawer, SpaceTaskEventDrawer } from "./SpacePlannerViews";
import { AgendaListView, AgendaMonthView, AgendaWeekView } from "./spaceAgenda/AgendaViews";
import { agendaRange, agendaTitle, moveAnchor, type AgendaView } from "./spaceAgenda/agendaDates";

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
  const { visibility } = useSpaceAgendaPreferences(user?.id ?? "", spaceId);
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
  }, [range.from.getTime(), range.to.getTime(), spaceId, user?.id]);

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
    params.set("date", next.toISOString().slice(0, 10));
    navigate({ pathname: location.pathname, search: `?${params}` }, { replace: true });
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
        provider: "google",
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
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-background">
      <header className="misty-spaces-toolbar flex min-h-12 flex-wrap items-center gap-2 px-4 py-2">
        <div>
          <h1 className="m-0 text-sm font-semibold">Agenda</h1>
          <p className="m-0 text-xs text-muted-foreground">{agendaTitle(anchor, view)}</p>
        </div>
        <SpaceViewModeToggle
          label="Agenda view"
          value={view}
          options={[
            { value: "month", label: "Month" },
            { value: "week", label: "Week" },
            { value: "list", label: "List" },
          ]}
          onChange={(next) =>
            navigate({
              pathname: `/spaces/${encodeURIComponent(spaceId)}/planner/agenda/${next}`,
              search: location.search,
            })
          }
        />
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous range"
            onClick={() => updateAnchor(moveAnchor(anchor, view, -1))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => updateAnchor(new Date())}>
            Today
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next range"
            onClick={() => updateAnchor(moveAnchor(anchor, view, 1))}
          >
            <ChevronRight className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh agenda"
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
          {canManageIntegrations ? (
            <Button variant="outline" size="sm" onClick={() => setDrawerOpen(true)}>
              <CalendarPlus className="size-4" />
              Calendars
            </Button>
          ) : null}
          {canManage ? (
            <Button
              size="sm"
              onClick={() =>
                navigate(`/spaces/${encodeURIComponent(spaceId)}/planner/tasks/board?create=task`)
              }
            >
              <Plus className="size-4" />
              Task
            </Button>
          ) : null}
        </div>
      </header>
      <main className="min-h-0 overflow-auto p-4" aria-label={`${view} agenda`}>
        {error ? (
          <div className="mb-3 flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <span>{error}</span>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        ) : null}
        {!loading && !visible.length ? (
          <div className="grid min-h-72 place-items-center text-center">
            <div>
              <h2 className="m-0 text-base font-semibold">Your agenda is clear</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Deadlines, roadmap dates, and connected calendars will appear here.
              </p>
            </div>
          </div>
        ) : view === "month" ? (
          <AgendaMonthView anchor={anchor} entries={visible} onOpen={openEntry} />
        ) : view === "week" ? (
          <AgendaWeekView anchor={anchor} entries={visible} onOpen={openEntry} />
        ) : (
          <AgendaListView entries={visible} onOpen={openEntry} />
        )}
      </main>
      {drawerOpen ? (
        <CalendarSourceDrawer
          integrations={integrations}
          selectedIntegration={selectedIntegration}
          choices={choices}
          sources={sources}
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
    </div>
  );
}
