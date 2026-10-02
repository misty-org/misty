import type { AccountConnection } from "@/api/connections";
import type { SpaceAgendaEntry } from "@/api/spaces/dto/interfaces/plannerExpansionTypes";
import type {
  GoogleCalendarChoice,
  SpaceCalendarEvent,
  SpaceCalendarSource,
  SpaceIntegration,
  SpaceTask,
} from "@/api/spaces/dto/interfaces/types";
import type { TaskDraft } from "@/api/spaces/dto/types/SpaceTaskPrimitives";
import { errorText } from "@/shared/lib/format";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  IconButton,
  Input,
  MenuItem,
  MenuTrigger,
  Popover,
  PopoverContent,
  Spinner,
} from "@/shared/ui";
import {
  CalendarCheck2,
  CalendarDays,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  RotateCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, useRef, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { agendaAiAdapter } from "./spaceAgenda/agendaAiSurface";
import { loadAgendaConnections } from "./spaceAgenda/agendaConnections";
import {
  agendaRange,
  agendaTitle,
  dayKey,
  moveAnchor,
  type AgendaView,
} from "./spaceAgenda/agendaDates";
import {
  AgendaMonthView,
  AgendaTimelineView,
  type AgendaZoomMinutes,
} from "./spaceAgenda/AgendaViews";
import type { PlannerCalendarRuntime } from "./spaceAgenda/calendarRuntime";
import { NewCalendarEventDialog } from "./spaceAgenda/NewCalendarEventDialog";
import { CalendarSourceDrawer, SpaceTaskDrawer, SpaceTaskEventDrawer } from "./SpacePlannerViews";
import { emptyDraft, taskDraft, taskUpdateInput } from "./spaceTasks/taskDraft";
export function SpaceAgendaView({
  spaceId,
  view,
  canManage,
  canManageIntegrations = false,
  runtime,
}: {
  spaceId: string;
  view: AgendaView;
  canManage: boolean;
  canManageIntegrations?: boolean;
  runtime: PlannerCalendarRuntime;
}) {
  const {
    api: spacesApi,
    connections: connectionsApi,
    members,
    visibility,
    setVisibility,
    subscribeChanges,
  } = runtime;
  const location = useLocation();
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState(() => {
    const value = new URLSearchParams(location.search).get("date");
    return value ? new Date(`${value}T12:00:00`) : new Date();
  });
  const [entries, setEntries] = useState<SpaceAgendaEntry[]>([]);
  const [sources, setSources] = useState<SpaceCalendarSource[]>([]);
  const [integrations, setIntegrations] = useState<SpaceIntegration[]>([]);
  const [accounts, setAccounts] = useState<AccountConnection[]>([]);
  const [choices, setChoices] = useState<GoogleCalendarChoice[]>([]);
  const [selectedIntegration, setSelectedIntegration] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [connectionsUnavailable, setConnectionsUnavailable] = useState(false);
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [eventOpen, setEventOpen] = useState<SpaceCalendarEvent>();
  const [taskOpen, setTaskOpen] = useState<SpaceTask>();
  const [agendaTasks, setAgendaTasks] = useState<Record<string, SpaceTask>>({});
  const [openTaskDraft, setOpenTaskDraft] = useState<TaskDraft>(emptyDraft);
  const [createEventOpen, setCreateEventOpen] = useState(false);
  const [zoomMinutes, setZoomMinutes] = useState<AgendaZoomMinutes>(30);
  const range = useMemo(() => agendaRange(anchor, view), [anchor, view]);
  const title =
    taskOpen?.title?.trim() ||
    eventOpen?.title?.trim() ||
    `${view[0].toUpperCase()}${view.slice(1)} agenda`;
  const loadCalendarConnections = useCallback(async () => {
    const result = await loadAgendaConnections(
      spaceId,
      canManageIntegrations,
      spacesApi,
      connectionsApi,
    );
    if (result.sources) setSources(result.sources);
    setIntegrations(result.integrations);
    setAccounts(result.accounts);
    setConnectionsUnavailable(result.unavailable);
  }, [spaceId, canManageIntegrations, spacesApi, connectionsApi]);
  useEffect(() => {
    void loadCalendarConnections();
  }, [loadCalendarConnections]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [agenda, taskPage] = await Promise.all([
        spacesApi.agenda(spaceId, range.from.toISOString(), range.to.toISOString()),
        spacesApi
          .tasks(spaceId, {
            dueFrom: range.from.toISOString(),
            dueTo: range.to.toISOString(),
            limit: 200,
          })
          .catch(() => null),
      ]);
      setEntries(agenda.entries);
      setAgendaTasks(
        Object.fromEntries((taskPage?.tasks ?? []).map((task) => [task.id, task] as const)),
      );
      setError("");
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, spaceId, spacesApi]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!drawerOpen) return;
    const refresh = () => void loadCalendarConnections();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [drawerOpen, loadCalendarConnections]);
  useEffect(() => subscribeChanges(() => void load()), [load, subscribeChanges]);
  const visible = entries.filter((entry) =>
    entry.kind === "task"
      ? visibility.tasks
      : entry.kind === "goal" || entry.kind === "milestone" || entry.kind === "roadmap_node"
        ? visibility.roadmap
        : !entry.source_id || !visibility.hiddenSources.includes(entry.source_id),
  );
  const aiAdapter = useMemo(
    () =>
      agendaAiAdapter({
        anchor,
        view,
        spaceId,
        href: location.pathname + location.search,
        range,
      }),
    [anchor, location.pathname, location.search, range, spaceId, view],
  );
  const updateAnchor = (next: Date) => {
    setAnchor(next);
    const params = new URLSearchParams(location.search);
    params.set("date", dayKey(next));
    navigate(
      {
        pathname: location.pathname,
        search: `?${params}`,
      },
      {
        replace: true,
      },
    );
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
  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError("");
    try {
      await action();
      setError("");
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy("");
    }
  };
  const openCalendarManager = () => {
    setDrawerOpen(true);
    const activeSelection = integrations.some(
      (item) => item.id === selectedIntegration && item.status === "active",
    );
    if (activeSelection) return;
    const firstActiveIntegration = integrations.find((item) => item.status === "active");
    if (!firstActiveIntegration) return;
    setSelectedIntegration(firstActiveIntegration.id);
    setChoices([]);
    void run("calendars", async () => {
      setChoices((await spacesApi.googleCalendars(spaceId, firstActiveIntegration.id)).calendars);
    });
  };
  const openTask = (taskId: string) => {
    const cachedTask = agendaTasks[taskId];
    if (cachedTask) {
      setEventOpen(undefined);
      setTaskOpen(cachedTask);
      setOpenTaskDraft(taskDraft(cachedTask));
      return;
    }
    void run(`open-task:${taskId}`, async () => {
      const task = await findAgendaTask(spacesApi, spaceId, taskId);
      setEventOpen(undefined);
      setTaskOpen(task);
      setOpenTaskDraft(taskDraft(task));
    });
  };
  const closeTask = () => {
    setTaskOpen(undefined);
    setOpenTaskDraft(emptyDraft());
  };
  const saveTask = (event: FormEvent) => {
    event.preventDefault();
    if (!canManage || !taskOpen || !openTaskDraft?.title.trim()) return;
    void run(`task:${taskOpen.id}`, async () => {
      await spacesApi.updateTask(spaceId, taskOpen, taskUpdateInput(openTaskDraft));
      closeTask();
      await load();
    });
  };
  const archiveTask = async () => {
    if (!taskOpen || !(await runtime.confirm(`Archive “${taskOpen.title}”?`))) return;
    await run(`task:${taskOpen.id}`, async () => {
      await spacesApi.archiveTask(spaceId, taskOpen);
      closeTask();
      await load();
    });
  };
  const saveEvent = (event: SpaceCalendarEvent) => {
    if (!canManage || event.provider !== "misty") return;
    void run(`event:${event.id}`, async () => {
      await spacesApi.updateCalendarEvent(spaceId, event);
      setEventOpen(undefined);
      await load();
    });
  };
  const deleteEvent = async () => {
    if (
      !canManage ||
      eventOpen?.provider !== "misty" ||
      !(await runtime.confirm(`Delete “${eventOpen.title}”?`))
    )
      return;
    await run(`event:${eventOpen.id}`, async () => {
      await spacesApi.deleteCalendarEvent(spaceId, eventOpen);
      setEventOpen(undefined);
      await load();
    });
  };
  const openEntry = (entry: SpaceAgendaEntry) => {
    if (entry.task_id) openTask(entry.task_id);
    else if (entry.kind === "event") {
      const source = sources.find((item) => item.id === entry.source_id);
      closeTask();
      setEventOpen({
        id: entry.id.replace(/^event:/, ""),
        space_id: spaceId,
        source_id: entry.source_id ?? "",
        provider: source?.provider ?? (entry.external_event_id ? "google" : "misty"),
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
        version: entry.version,
      });
    } else if (entry.roadmap_id) {
      const selection = new URLSearchParams(
        entry.roadmap_node_id
          ? {
              node: entry.roadmap_node_id,
            }
          : entry.goal_id
            ? {
                goal: entry.goal_id,
              }
            : {
                milestone: entry.milestone_id ?? "",
              },
      );
      navigate(
        `/spaces/${encodeURIComponent(spaceId)}/planner/roadmaps/${encodeURIComponent(entry.roadmap_id)}?${selection}`,
      );
    }
  };
  const linkedEntryRef = useRef("");
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get("entry");
    if (!id || loading || linkedEntryRef.current === id) return;
    const entry = entries.find((item) => item.id === id);
    if (!entry) return;
    linkedEntryRef.current = id;
    params.delete("entry");
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
    openEntry(entry);
  });
  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-charcoal-bg">
      {runtime.renderIntegration({
        title,
        adapter: aiAdapter,
      })}
      {
        <header
          className={[
            "misty-transient-scrollbar flex min-h-11 flex-nowrap items-center",
            "overflow-x-auto border-b border-charcoal-border bg-charcoal-bg px-3 py-1.5",
          ].join(" ")}
        >
          <div className="flex min-w-max flex-nowrap items-center gap-3">
            {canManage ? (
              <Button className="h-8 gap-1.5 text-xs" onClick={() => setCreateEventOpen(true)}>
                <Plus className="size-3.5" />
                New
              </Button>
            ) : null}

            <Button
              variant="ghost"
              className="h-8 gap-1.5 px-2.5 text-xs font-medium"
              aria-label="Google Calendar"
              onClick={openCalendarManager}
            >
              <CalendarPlus className="size-3.5" />
              Calendars
            </Button>

            <div className="flex items-center gap-1.5">
              <IconButton
                label="Previous range"
                onClick={() => updateAnchor(moveAnchor(anchor, view, -1))}
              >
                <ChevronLeft className="size-4" />
              </IconButton>
              <Popover>
                <MenuTrigger
                  kind="popover"
                  label="Choose calendar date"
                  value={agendaTitle(anchor, view)}
                  className="h-8 min-w-32 justify-between px-2.5 text-xs font-medium"
                />
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
              <IconButton
                label="Next range"
                onClick={() => updateAnchor(moveAnchor(anchor, view, 1))}
              >
                <ChevronRight className="size-4" />
              </IconButton>
              <IconButton
                label="Go to today"
                title="Today"
                onClick={() => updateAnchor(new Date())}
              >
                <CalendarCheck2 className="size-4" />
              </IconButton>
            </div>

            <DropdownMenu>
              <MenuTrigger
                label="Calendar view"
                value={view[0].toUpperCase() + view.slice(1)}
                icon={<CalendarDays className="size-3.5" />}
                className="h-8 min-w-24 justify-between px-2.5 text-xs font-medium"
              />
              <DropdownMenuContent align="start">
                {(["month", "week", "day"] as const).map((option) => (
                  <MenuItem
                    label={option[0].toUpperCase() + option.slice(1)}
                    key={option}
                    className={view === option ? "bg-charcoal-hover text-cream" : undefined}
                    onSelect={() => updateView(option)}
                  />
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {view !== "month" ? (
              <div
                className="flex h-8 items-center overflow-hidden rounded-md border border-charcoal-border/70"
                aria-label="Calendar time interval"
              >
                <IconButton
                  label="Zoom out calendar"
                  disabled={zoomMinutes === 60}
                  onClick={() => updateZoom("out")}
                >
                  <Minus className="size-3.5" />
                </IconButton>
                <span className="min-w-14 px-2 text-center text-xs font-medium">
                  {zoomMinutes} min
                </span>
                <IconButton
                  label="Zoom in calendar"
                  disabled={zoomMinutes === 15}
                  onClick={() => updateZoom("in")}
                >
                  <Plus className="size-3.5" />
                </IconButton>
              </div>
            ) : null}

            <IconButton
              label="Refresh calendar"
              className="text-cream-muted/70"
              onClick={() =>
                void run("sync", async () => {
                  await spacesApi.syncCalendarTasks(spaceId);
                  await load();
                })
              }
            >
              {loading ? <Spinner label={false} /> : <RotateCw className="size-4" />}
            </IconButton>
          </div>
        </header>
      }
      <main className="relative min-h-0 overflow-hidden" aria-label={`${view} agenda`}>
        {error ? runtime.renderError(error) : null}
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
          accounts={accounts}
          selectedIntegration={selectedIntegration}
          choices={choices}
          sources={sources}
          visibility={visibility}
          onVisibilityChange={setVisibility}
          canManage={canManageIntegrations}
          connectionsUnavailable={connectionsUnavailable}
          busy={busy}
          onSelect={(id) => {
            setSelectedIntegration(id);
            setChoices([]);
            if (id) {
              void run("calendars", async () => {
                setChoices((await spacesApi.googleCalendars(spaceId, id)).calendars);
              });
            }
          }}
          onConnect={() =>
            void run("connect-google", async () => {
              const authorization = await connectionsApi.authorize(
                "google",
                ["calendar_read", "calendar_write"],
                location.pathname + location.search,
              );
              await runtime.openAuthorization(authorization.authorization_url);
            })
          }
          onBind={(account) =>
            void run(`bind:${account.id}`, async () => {
              const result = await spacesApi.bindAccountConnection(
                spaceId,
                "google",
                account.id,
                "calendar_read",
              );
              setSelectedIntegration(result.integration.id);
              await loadCalendarConnections();
              setChoices(
                (await spacesApi.googleCalendars(spaceId, result.integration.id)).calendars,
              );
            })
          }
          onPublish={(choice) =>
            void run(choice.id, async () => {
              await spacesApi.publishGoogleCalendar(spaceId, selectedIntegration, choice);
              await Promise.all([load(), loadCalendarConnections()]);
            })
          }
          onDisable={(source) =>
            void run(source.id, async () => {
              await spacesApi.disableCalendarSource(spaceId, source.id);
              await Promise.all([load(), loadCalendarConnections()]);
            })
          }
          onClose={() => setDrawerOpen(false)}
        />
      ) : null}
      {eventOpen ? (
        <SpaceTaskEventDrawer
          event={eventOpen}
          busy={busy === `event:${eventOpen.id}`}
          canManage={canManage}
          error={error}
          onClose={() => setEventOpen(undefined)}
          onDelete={() => void deleteEvent()}
          onSave={saveEvent}
        />
      ) : null}
      {taskOpen ? (
        <SpaceTaskDrawer
          draft={openTaskDraft}
          setDraft={setOpenTaskDraft}
          editing={taskOpen}
          members={members}
          busy={busy === `task:${taskOpen.id}`}
          canManage={canManage}
          onClose={closeTask}
          onSave={saveTask}
          onArchive={() => void archiveTask()}
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
async function findAgendaTask(
  spacesApi: PlannerCalendarRuntime["api"],
  spaceId: string,
  taskId: string,
): Promise<SpaceTask> {
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  do {
    const page = await spacesApi.tasks(spaceId, {
      cursor,
      includeArchived: true,
      limit: 200,
    });
    const task = page.tasks.find((item) => item.id === taskId);
    if (task) return task;
    cursor = page.next_cursor;
    if (cursor && seenCursors.has(cursor)) break;
    if (cursor) seenCursors.add(cursor);
  } while (cursor);
  throw new Error("This task is no longer available.");
}
