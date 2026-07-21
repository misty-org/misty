import type { TaskViewMode, DueFilter } from "@/models/types/features/spaces/SpaceTasksCalendar";
export type { TaskViewMode, DueFilter } from "@/models/types/features/spaces/SpaceTasksCalendar";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/ui";
import { Checkbox } from "@/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui";
import { useAuth } from "@/features/auth/AuthContext";
import { confirmAction } from "@/lib/confirmAction";
import { errorText } from "@/lib/format";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import type { SpaceIntegration } from "@/models/interfaces/features/spaces/types";
import type { SpaceTaskPriority, SpaceTaskStatus } from "@/models/types/features/spaces/types";
import type {
  GoogleCalendarChoice,
  SpaceCalendarEvent,
  SpaceCalendarSource,
  SpaceMember,
  SpaceTask,
} from "@/models/interfaces/features/spaces/types";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import { TaskErrorState, toLocalInput } from "./SpaceTaskPrimitives";
import { SpaceTasksHeader } from "./components/SpaceTasksHeader";
import {
  CalendarSourceDrawer,
  SpaceTaskBoard,
  SpaceTaskCalendar,
  SpaceTaskDrawer,
  SpaceTaskEventDrawer,
  SpaceTaskList,
  type TaskDraft,
} from "./SpaceTasksViews";

const emptyMembers: SpaceMember[] = [];
const emptyDraft = (): TaskDraft => ({
  title: "",
  notes: "",
  status: "todo",
  priority: "medium",
  assignee_user_id: "",
  due_at: "",
  due_timezone: localTimezone(),
});

export function SpaceTasksCalendar({
  spaceId,
  canManage,
  canManageIntegrations,
}: {
  spaceId: string;
  canManage: boolean;
  canManageIntegrations: boolean;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const members = useSpacesStore((state) => state.membersBySpace[spaceId] ?? emptyMembers);
  const routeParts = location.pathname.split("/").filter(Boolean);
  const view = normalizeView(routeParts[routeParts.length - 1]);
  const [tasks, setTasks] = useState<SpaceTask[]>([]);
  const [events, setEvents] = useState<SpaceCalendarEvent[]>([]);
  const [sources, setSources] = useState<SpaceCalendarSource[]>([]);
  const [integrations, setIntegrations] = useState<SpaceIntegration[]>([]);
  const [statusTotals, setStatusTotals] = useState<Record<string, number>>({});
  const [nextCursor, setNextCursor] = useState("");
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [editing, setEditing] = useState<SpaceTask | null | undefined>(undefined);
  const [eventOpen, setEventOpen] = useState<SpaceCalendarEvent>();
  const [draft, setDraft] = useState<TaskDraft>(emptyDraft);
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sourceOpen, setSourceOpen] = useState(false);
  const [selectedIntegration, setSelectedIntegration] = useState("");
  const [calendarChoices, setCalendarChoices] = useState<GoogleCalendarChoice[]>([]);
  const [calendarNotice, setCalendarNotice] = useState("");
  const [calendarConnectionsUnavailable, setCalendarConnectionsUnavailable] = useState(false);
  const loadGenerationRef = useRef(0);

  const query = searchParams.get("q") ?? "";
  const status = (searchParams.get("status") as SpaceTaskStatus | "all") || "all";
  const assignee = searchParams.get("assignee") ?? "all";
  const priority = (searchParams.get("priority") as SpaceTaskPriority | "all") || "all";
  const due = (searchParams.get("due") as DueFilter) || "all";
  const mine = searchParams.get("mine") === "1";
  const sort =
    (searchParams.get("sort") as "rank" | "due" | "updated") || (view === "board" ? "rank" : "due");
  const range = useMemo(() => calendarRange(month), [month]);
  const dueRange = useMemo(() => filterDueRange(due), [due]);
  const effectiveAssignee = mine
    ? user?.id || ""
    : assignee !== "all" && assignee !== "unassigned"
      ? assignee
      : "";

  const updateParam = (key: string, value?: string) => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === "all" || value === "0") next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };
  const changeView = (next: TaskViewMode) =>
    navigate(
      `/spaces/${encodeURIComponent(spaceId)}/tasks/${next}${searchParams.size ? `?${searchParams}` : ""}`,
    );

  const load = useCallback(
    async (append = false) => {
      const loadGeneration = ++loadGenerationRef.current;
      setLoading(true);
      try {
        const taskRequest = spacesApi.tasks(spaceId, {
          status: status === "all" ? undefined : status,
          assigneeUserId: effectiveAssignee || undefined,
          priority: priority === "all" ? undefined : priority,
          search: query.trim() || undefined,
          dueFrom: dueRange?.from,
          dueTo: dueRange?.to,
          sort,
          cursor: append ? nextCursor : undefined,
          limit: 200,
        });
        const optionalRequest = Promise.allSettled([
          spacesApi.calendarSources(spaceId),
          spacesApi.integrations(spaceId),
          view === "calendar"
            ? spacesApi.calendarEvents(spaceId, range.from.toISOString(), range.to.toISOString())
            : Promise.resolve({ events: [] as SpaceCalendarEvent[] }),
        ]);
        const taskResult = await taskRequest;
        if (loadGeneration !== loadGenerationRef.current) return;
        setTasks((current) => (append ? mergeTasks(current, taskResult.tasks) : taskResult.tasks));
        setNextCursor(taskResult.next_cursor ?? "");
        setStatusTotals(taskResult.status_totals ?? {});
        setError("");
        setLoading(false);

        const [sourceResult, integrationResult, eventResult] = await optionalRequest;
        if (loadGeneration !== loadGenerationRef.current) return;
        setSources(sourceResult.status === "fulfilled" ? sourceResult.value.sources : []);
        setIntegrations(
          integrationResult.status === "fulfilled"
            ? integrationResult.value.integrations.filter((item) => item.provider === "google")
            : [],
        );
        setEvents(eventResult.status === "fulfilled" ? eventResult.value.events : []);
        setCalendarConnectionsUnavailable(integrationResult.status === "rejected");
        const unavailable = [
          sourceResult.status === "rejected" ? "calendar sync status" : "",
          integrationResult.status === "rejected" ? "Google Calendar connections" : "",
          eventResult.status === "rejected" ? "published calendar events" : "",
        ].filter(Boolean);
        setCalendarNotice(
          unavailable.length
            ? `Tasks are available, but ${unavailable.join(" and ")} could not be checked.`
            : "",
        );
      } catch (reason) {
        if (loadGeneration === loadGenerationRef.current) setError(errorText(reason));
      } finally {
        if (loadGeneration === loadGenerationRef.current) setLoading(false);
      }
    },
    [
      dueRange?.from,
      dueRange?.to,
      effectiveAssignee,
      nextCursor,
      priority,
      query,
      range.from,
      range.to,
      sort,
      spaceId,
      status,
      view,
    ],
  );

  useEffect(() => {
    void load(false);
  }, [
    dueRange?.from,
    dueRange?.to,
    effectiveAssignee,
    priority,
    query,
    range.from,
    range.to,
    sort,
    spaceId,
    status,
    view,
  ]);
  useEffect(() => {
    const reload = (event: Event) => {
      if ((event as CustomEvent<{ space_id?: string }>).detail?.space_id === spaceId)
        void load(false);
    };
    window.addEventListener("misty:space-coordination-event", reload);
    return () => window.removeEventListener("misty:space-coordination-event", reload);
  }, [load, spaceId]);
  useEffect(() => {
    const openCreateShortcut = (event: KeyboardEvent) => {
      if (
        !canManage ||
        event.key.toLowerCase() !== "c" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isTypingTarget(event.target)
      )
        return;
      event.preventDefault();
      openCreate();
    };
    window.addEventListener("keydown", openCreateShortcut);
    return () => window.removeEventListener("keydown", openCreateShortcut);
  });

  const visibleTasks = tasks.filter(
    (task) => !(assignee === "unassigned" && task.assignee_user_id) && matchesDueFilter(task, due),
  );
  const openCreate = (initialStatus: SpaceTaskStatus = "todo") => {
    setDraft({ ...emptyDraft(), status: initialStatus });
    setEditing(null);
  };
  const openEdit = (task: SpaceTask) => {
    setDraft(taskDraft(task));
    setEditing(task);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage || !draft.title.trim()) return;
    setBusy("task");
    try {
      const patch = {
        ...draft,
        title: draft.title.trim(),
        notes: draft.notes.trim(),
        due_at: dueAtForRequest(draft.due_at),
        due_timezone: draft.due_timezone.trim() || "UTC",
        source_refs: editing?.source_refs ?? [],
      };
      const saved = editing
        ? await spacesApi.updateTask(spaceId, editing, patch)
        : await spacesApi.createTask(spaceId, createTaskInput(draft));
      setTasks((current) => mergeTasks(current, [saved]));
      setEditing(undefined);
      setError("");
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy("");
    }
  };
  const quickCreate = async (title: string, initialStatus: SpaceTaskStatus) => {
    if (!canManage || !title.trim()) return;
    setBusy(`create:${initialStatus}`);
    try {
      const saved = await spacesApi.createTask(
        spaceId,
        createTaskInput({ ...emptyDraft(), title, status: initialStatus }),
      );
      setTasks((current) => mergeTasks(current, [saved]));
      setError("");
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy("");
    }
  };
  const updateTask = async (
    task: SpaceTask,
    patch: Partial<
      Pick<
        SpaceTask,
        "title" | "notes" | "status" | "priority" | "assignee_user_id" | "due_at" | "due_timezone"
      >
    >,
  ) => {
    setBusy(task.id);
    try {
      const saved = await spacesApi.updateTask(spaceId, task, patch);
      setTasks((current) => mergeTasks(current, [saved]));
      return saved;
    } catch (reason) {
      setError(errorText(reason));
      return undefined;
    } finally {
      setBusy("");
    }
  };
  const moveTask = async (task: SpaceTask, nextStatus: SpaceTaskStatus, beforeTaskId?: string) => {
    if (!canManage) return;
    const previous = tasks;
    setTasks((current) => optimisticMove(current, task.id, nextStatus, beforeTaskId));
    setBusy(task.id);
    try {
      const result = await spacesApi.moveTask(spaceId, task, nextStatus, beforeTaskId);
      setTasks((current) =>
        mergeTasks(current, result.reordered.length ? result.reordered : [result.task]),
      );
    } catch (reason) {
      setTasks(previous);
      setError(errorText(reason));
    } finally {
      setBusy("");
    }
  };
  const archive = async (task: SpaceTask) => {
    if (!(await confirmAction(`Archive “${task.title}”?`))) return;
    setBusy(task.id);
    try {
      await spacesApi.archiveTask(spaceId, task);
      setTasks((current) => current.filter((item) => item.id !== task.id));
      setEditing(undefined);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy("");
    }
  };
  const loadCalendars = async (integrationId: string) => {
    setSelectedIntegration(integrationId);
    setCalendarChoices([]);
    if (!integrationId) return;
    setBusy("calendars");
    try {
      setCalendarChoices((await spacesApi.googleCalendars(spaceId, integrationId)).calendars);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy("");
    }
  };
  const publishCalendar = async (calendar: GoogleCalendarChoice) => {
    if (!selectedIntegration) return;
    setBusy(calendar.id);
    try {
      await spacesApi.publishGoogleCalendar(spaceId, selectedIntegration, calendar);
      await load(false);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy("");
    }
  };
  /**
   * Sends a task's schedule to Google. Explicit by design — editing a task in
   * Misty never writes to someone's calendar on its own.
   */
  const publishCalendarTask = async (task: SpaceTask) => {
    setBusy(task.id);
    try {
      const saved = await spacesApi.publishTaskToCalendar(spaceId, task);
      setTasks((current) => mergeTasks(current, [saved]));
      setEditing(saved);
      setError("");
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy("");
    }
  };
  const discardCalendarChanges = async (task: SpaceTask) => {
    if (!(await confirmAction("Discard your changes and use Google Calendar's version?"))) return;
    setBusy(task.id);
    try {
      const saved = await spacesApi.resolveTaskCalendarConflict(spaceId, task, "discard_local");
      setTasks((current) => mergeTasks(current, [saved]));
      setEditing(saved);
      setDraft(taskDraft(saved));
      setError("");
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy("");
    }
  };

  const clearFilters = () => {
    const next = new URLSearchParams(searchParams);
    ["status", "assignee", "priority", "due", "mine", "sort"].forEach((key) => next.delete(key));
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-background">
      <SpaceTasksHeader
        view={view}
        query={query}
        activeFilterCount={activeFilterCount(searchParams)}
        sources={sources}
        loading={loading}
        canManage={canManage}
        canManageIntegrations={canManageIntegrations}
        calendarImportAvailable={
          sources.length > 0 || integrations.some((integration) => integration.status === "active")
        }
        onView={changeView}
        onQuery={(value: string) => updateParam("q", value)}
        onSync={() => void load(false)}
        onImport={() => setSourceOpen(true)}
        onCreate={() => openCreate()}
        filters={
          <TaskFilters
            members={members}
            status={status}
            assignee={assignee}
            priority={priority}
            due={due}
            mine={mine}
            sort={sort}
            onChange={updateParam}
            onClear={clearFilters}
          />
        }
      />
      {/* The board owns its own scrolling (horizontal columns, vertical cards); the list does not. */}
      <section className={`min-h-0 p-4 ${view === "board" ? "overflow-hidden" : "overflow-auto"}`}>
        {error ? <TaskErrorState message={error} onDismiss={() => setError("")} /> : null}
        {calendarNotice ? (
          <p
            className="mx-0 mb-3 mt-0 rounded-md bg-muted/55 px-3 py-2 text-xs text-muted-foreground"
            role="status"
          >
            {calendarNotice}
          </p>
        ) : null}
        {loading && !tasks.length && !events.length ? (
          <div className="grid h-full min-h-56 place-items-center text-muted-foreground">
            <LoaderCircle className="size-5 animate-spin" aria-label="Loading tasks" />
          </div>
        ) : view === "board" ? (
          <SpaceTaskBoard
            tasks={visibleTasks.filter((task) => task.status !== "canceled")}
            members={members}
            totals={statusTotals}
            busy={busy}
            canManage={canManage}
            onOpen={openEdit}
            onMove={moveTask}
            onCreate={quickCreate}
          />
        ) : view === "list" ? (
          <SpaceTaskList
            tasks={visibleTasks}
            members={members}
            busy={busy}
            canManage={canManage}
            onOpen={openEdit}
            onUpdate={updateTask}
          />
        ) : (
          <SpaceTaskCalendar
            month={month}
            tasks={visibleTasks}
            events={events}
            members={members}
            onMonth={setMonth}
            onOpenTask={openEdit}
            onOpenEvent={setEventOpen}
          />
        )}
        {nextCursor && view === "list" ? (
          <Button
            className="mx-auto mt-4 flex"
            variant="outline"
            disabled={loading}
            type="button"
            onClick={() => void load(true)}
          >
            {loading ? <LoaderCircle className="size-4 animate-spin" /> : null}Load more
          </Button>
        ) : null}
      </section>
      {editing !== undefined ? (
        <SpaceTaskDrawer
          draft={draft}
          setDraft={setDraft}
          editing={editing}
          members={members}
          busy={busy === "task" || busy === editing?.id}
          canManage={canManage}
          onClose={() => setEditing(undefined)}
          onSave={save}
          onArchive={editing ? () => void archive(editing) : undefined}
          onPublishCalendar={
            editing?.calendar ? () => void publishCalendarTask(editing) : undefined
          }
          onDiscardCalendar={
            editing?.calendar ? () => void discardCalendarChanges(editing) : undefined
          }
        />
      ) : null}
      {eventOpen ? (
        <SpaceTaskEventDrawer
          event={eventOpen}
          source={sources.find((item) => item.id === eventOpen.source_id)}
          onClose={() => setEventOpen(undefined)}
        />
      ) : null}
      {sourceOpen ? (
        <CalendarSourceDrawer
          integrations={integrations}
          selectedIntegration={selectedIntegration}
          choices={calendarChoices}
          sources={sources}
          connectionsUnavailable={calendarConnectionsUnavailable}
          busy={busy}
          onSelect={(id) => void loadCalendars(id)}
          onPublish={(choice) => void publishCalendar(choice)}
          onDisable={async (source) => {
            setBusy(source.id);
            try {
              await spacesApi.disableCalendarSource(spaceId, source.id);
              await load(false);
            } catch (reason) {
              setError(errorText(reason));
            } finally {
              setBusy("");
            }
          }}
          onClose={() => setSourceOpen(false)}
        />
      ) : null}
    </div>
  );
}

function TaskFilters({
  members,
  status,
  assignee,
  priority,
  due,
  mine,
  sort,
  onChange,
  onClear,
}: {
  members: SpaceMember[];
  status: string;
  assignee: string;
  priority: string;
  due: string;
  mine: boolean;
  sort: string;
  onChange: (key: string, value?: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="grid gap-3" aria-label="Task filters">
      <div>
        <h3 className="m-0 text-sm font-semibold">Filter tasks</h3>
        <p className="mb-0 mt-1 text-xs text-muted-foreground">Narrow the current task view.</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <TaskFilterSelect
          label="Status"
          value={status}
          options={[
            ["all", "Any status"],
            ["todo", "To do"],
            ["in_progress", "In progress"],
            ["done", "Done"],
            ["canceled", "Canceled"],
          ]}
          onChange={(value) => onChange("status", value)}
        />
        <TaskFilterSelect
          label="Assignee"
          value={assignee}
          options={[
            ["all", "Any assignee"],
            ["unassigned", "Unassigned"],
            ...members.map((member) => [member.user_id, member.name] as [string, string]),
          ]}
          onChange={(value) => onChange("assignee", value)}
        />
        <TaskFilterSelect
          label="Priority"
          value={priority}
          options={[
            ["all", "Any priority"],
            ["high", "High"],
            ["medium", "Medium"],
            ["low", "Low"],
          ]}
          onChange={(value) => onChange("priority", value)}
        />
        <TaskFilterSelect
          label="Due date"
          value={due}
          options={[
            ["all", "Any due date"],
            ["overdue", "Overdue"],
            ["today", "Today"],
            ["week", "Next 7 days"],
            ["no_due", "No due date"],
          ]}
          onChange={(value) => onChange("due", value)}
        />
        <TaskFilterSelect
          label="Sort"
          value={sort}
          options={[
            ["rank", "Rank"],
            ["due", "Due date"],
            ["updated", "Updated"],
          ]}
          onChange={(value) => onChange("sort", value)}
        />
        <label className="flex h-9 items-center gap-2 rounded-md border px-3 text-xs">
          <Checkbox
            checked={mine}
            onCheckedChange={(checked) => onChange("mine", checked === true ? "1" : undefined)}
          />
          Assigned to me
        </label>
      </div>
      <Button
        className="justify-self-end"
        size="sm"
        variant="ghost"
        type="button"
        onClick={onClear}
      >
        Clear filters
      </Button>
    </div>
  );
}

function TaskFilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-full text-xs" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([id, name]) => (
          <SelectItem value={id} key={id}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function localTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
function dueAtForRequest(value: string) {
  if (!value.trim()) return undefined;
  const dueAt = new Date(value);
  if (Number.isNaN(dueAt.getTime())) throw new Error("Enter a valid due date and time.");
  return dueAt.toISOString();
}
function createTaskInput(draft: TaskDraft, sourceRefs: SpaceTask["source_refs"] = []) {
  const assigneeUserId = draft.assignee_user_id.trim();
  const dueAt = dueAtForRequest(draft.due_at);
  return {
    title: draft.title.trim(),
    notes: draft.notes.trim(),
    status: draft.status,
    priority: draft.priority,
    due_timezone: draft.due_timezone.trim() || "UTC",
    source_refs: sourceRefs,
    ...(assigneeUserId ? { assignee_user_id: assigneeUserId } : {}),
    ...(dueAt ? { due_at: dueAt } : {}),
  };
}
function normalizeView(value?: string): TaskViewMode {
  return value === "list" || value === "calendar" ? value : "board";
}
function taskDraft(task: SpaceTask): TaskDraft {
  return {
    title: task.title,
    notes: task.notes,
    status: task.status,
    priority: task.priority,
    assignee_user_id: task.assignee_user_id ?? "",
    due_at: task.due_at ? toLocalInput(task.due_at) : "",
    due_timezone: task.due_timezone || "UTC",
  };
}
function mergeTasks(current: SpaceTask[], incoming: SpaceTask[]) {
  const next = new Map(current.map((item) => [item.id, item]));
  incoming.forEach((item) => next.set(item.id, item));
  return [...next.values()].sort(
    (a, b) => a.status.localeCompare(b.status) || a.rank - b.rank || a.id.localeCompare(b.id),
  );
}
function optimisticMove(
  tasks: SpaceTask[],
  id: string,
  status: SpaceTaskStatus,
  beforeId?: string,
) {
  const moving = tasks.find((item) => item.id === id);
  if (!moving) return tasks;
  const rest = tasks.filter((item) => item.id !== id);
  const column = rest.filter((item) => item.status === status).sort((a, b) => a.rank - b.rank);
  const index = beforeId
    ? Math.max(
        0,
        column.findIndex((item) => item.id === beforeId),
      )
    : column.length;
  column.splice(index, 0, { ...moving, status });
  const ranked = new Map(
    column.map((item, itemIndex) => [item.id, { ...item, rank: (itemIndex + 1) * 1024 }]),
  );
  return rest.map((item) => ranked.get(item.id) ?? item).concat(ranked.get(id) ?? moving);
}
function activeFilterCount(params: URLSearchParams) {
  return ["status", "assignee", "priority", "due", "mine"].filter((key) => params.has(key)).length;
}
function isTypingTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}
function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
function calendarRange(month: Date) {
  return {
    from: new Date(month.getFullYear(), month.getMonth() - 1, 1),
    to: new Date(month.getFullYear(), month.getMonth() + 2, 1),
  };
}
function filterDueRange(filter: DueFilter): { from?: string; to?: string } | undefined {
  const now = new Date();
  if (filter === "overdue") return { to: now.toISOString() };
  if (filter === "today") {
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    return { from: from.toISOString(), to: to.toISOString() };
  }
  if (filter === "week") {
    const to = new Date(now);
    to.setDate(to.getDate() + 7);
    return { from: now.toISOString(), to: to.toISOString() };
  }
  return undefined;
}
function matchesDueFilter(task: SpaceTask, filter: DueFilter) {
  if (filter === "no_due") return !task.due_at;
  if (filter === "overdue")
    return Boolean(
      task.due_at &&
      new Date(task.due_at) < new Date() &&
      task.status !== "done" &&
      task.status !== "canceled",
    );
  return true;
}
