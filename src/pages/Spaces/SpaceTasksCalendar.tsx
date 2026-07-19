import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  CalendarDays,
  Filter,
  KanbanSquare,
  List,
  LoaderCircle,
  Plus,
  RefreshCcw,
  Search,
  X,
} from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "../../auth/AuthContext";
import { confirmAction } from "../../shared/confirmAction";
import { errorText } from "../../shared/format";
import { agentArchitectureApi } from "../../spaces/agentArchitectureApi";
import { spacesApi } from "../../spaces/api";
import type {
  GoogleCalendarChoice,
  SpaceCalendarEvent,
  SpaceCalendarSource,
  SpaceIntegration,
  SpaceMember,
  SpaceTask,
  SpaceTaskPriority,
  SpaceTaskStatus,
} from "../../spaces/types";
import { useSpacesStore } from "../../stores/useSpacesStore";
import { memberInitials, TaskErrorState, toLocalInput } from "./SpaceTaskPrimitives";
import {
  CalendarSourceDrawer,
  SpaceTaskBoard,
  SpaceTaskCalendar,
  SpaceTaskDrawer,
  SpaceTaskEventDrawer,
  SpaceTaskList,
  type TaskDraft,
} from "./SpaceTasksViews";

export type TaskViewMode = "board" | "list" | "calendar";
export type DueFilter = "all" | "overdue" | "today" | "week" | "no_due";

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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedIntegration, setSelectedIntegration] = useState("");
  const [calendarChoices, setCalendarChoices] = useState<GoogleCalendarChoice[]>([]);

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
  const effectiveAssignee =
    mine ? user?.id || "" : assignee !== "all" && assignee !== "unassigned" ? assignee : "";

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
        const [taskResult, sourceResult, integrationResult, eventResult] = await Promise.all([
          taskRequest,
          spacesApi.calendarSources(spaceId),
          agentArchitectureApi.integrations(spaceId),
          view === "calendar"
            ? spacesApi.calendarEvents(spaceId, range.from.toISOString(), range.to.toISOString())
            : Promise.resolve({ events: [] as SpaceCalendarEvent[] }),
        ]);
        setTasks((current) => (append ? mergeTasks(current, taskResult.tasks) : taskResult.tasks));
        setNextCursor(taskResult.next_cursor ?? "");
        setStatusTotals(taskResult.status_totals ?? {});
        setSources(sourceResult.sources);
        setIntegrations(integrationResult.integrations.filter((item) => item.provider === "google"));
        setEvents(eventResult.events);
        setError("");
      } catch (reason) {
        setError(errorText(reason));
      } finally {
        setLoading(false);
      }
    },
    [dueRange?.from, dueRange?.to, effectiveAssignee, nextCursor, priority, query, range.from, range.to, sort, spaceId, status, view],
  );

  useEffect(() => {
    void load(false);
  }, [dueRange?.from, dueRange?.to, effectiveAssignee, priority, query, range.from, range.to, sort, spaceId, status, view]);
  useEffect(() => {
    const reload = (event: Event) => {
      if ((event as CustomEvent<{ space_id?: string }>).detail?.space_id === spaceId) void load(false);
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
      ) return;
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
    patch: Partial<Pick<SpaceTask, "title" | "notes" | "status" | "priority" | "assignee_user_id" | "due_at" | "due_timezone">>,
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
      setTasks((current) => mergeTasks(current, result.reordered.length ? result.reordered : [result.task]));
    } catch (reason) {
      setTasks(previous);
      setError(errorText(reason));
    } finally {
      setBusy("");
    }
  };
  const archive = async (task: SpaceTask) => {
    if (!await confirmAction(`Archive “${task.title}”?`)) return;
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
  const clearFilters = () => {
    const next = new URLSearchParams(searchParams);
    ["status", "assignee", "priority", "due", "mine", "sort"].forEach((key) => next.delete(key));
    setSearchParams(next, { replace: true });
    setFiltersOpen(false);
  };

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-background">
      <header className="flex min-h-13 flex-wrap items-center gap-2 border-b border-border/60 bg-card px-4 py-2">
        <Tabs value={view} onValueChange={(next) => changeView(next as TaskViewMode)}>
          <TabsList className="h-9" aria-label="Task views">
            <TabsTrigger className="gap-1.5 px-2.5 text-xs" value="board"><KanbanSquare className="size-3.5" />Board</TabsTrigger>
            <TabsTrigger className="gap-1.5 px-2.5 text-xs" value="list"><List className="size-3.5" />List</TabsTrigger>
            <TabsTrigger className="gap-1.5 px-2.5 text-xs" value="calendar"><CalendarDays className="size-3.5" />Calendar</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative min-w-44 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-9 pl-8 pr-8 text-xs" aria-label="Search tasks" placeholder="Search tasks" value={query} onChange={(event) => updateParam("q", event.target.value)} />
          {query ? <Button className="absolute right-1 top-1/2 size-7 -translate-y-1/2" size="icon" variant="ghost" type="button" onClick={() => updateParam("q")} aria-label="Clear search"><X className="size-3.5" /></Button> : null}
        </div>
        {members.length ? <div className="flex -space-x-1.5" aria-label="Filter by assignee">{members.slice(0, 5).map((member) => {
          const selected = assignee === member.user_id || (mine && member.user_id === user?.id);
          return <Button className={`size-8 rounded-full p-0 ring-offset-background ${selected ? "z-10 ring-2 ring-primary ring-offset-1" : ""}`} variant="ghost" type="button" title={member.name} aria-label={`Filter by ${member.name}`} aria-pressed={selected} key={member.user_id} onClick={() => {
            const next = new URLSearchParams(searchParams);
            next.delete("mine");
            if (selected) next.delete("assignee"); else next.set("assignee", member.user_id);
            setSearchParams(next, { replace: true });
          }}><Avatar className="size-7"><AvatarFallback className="text-[9px]">{memberInitials(member.name)}</AvatarFallback></Avatar></Button>;
        })}</div> : null}
        <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
          <PopoverTrigger asChild><Button variant="outline" type="button"><Filter className="size-3.5" />Filter{activeFilterCount(searchParams) ? <Badge className="ml-0.5 h-5 min-w-5 justify-center px-1.5" variant="secondary">{activeFilterCount(searchParams)}</Badge> : null}</Button></PopoverTrigger>
          <PopoverContent className="w-[min(420px,calc(100vw-24px))]" align="end"><TaskFilters members={members} status={status} assignee={assignee} priority={priority} due={due} mine={mine} sort={sort} onChange={updateParam} onClear={clearFilters} /></PopoverContent>
        </Popover>
        {canManageIntegrations ? <Button className="relative" size="icon" variant="outline" type="button" onClick={() => setSourceOpen(true)} aria-label="Calendars" title="Calendars"><CalendarDays className="size-4" />{sources.some((source) => source.status !== "active") ? <span className="absolute right-1 top-1 size-1.5 rounded-full bg-amber-500" /> : null}</Button> : null}
        <Button size="icon" variant="outline" type="button" onClick={() => void load(false)} aria-label="Refresh tasks" title="Refresh"><RefreshCcw className={`size-4 ${loading ? "animate-spin" : ""}`} /></Button>
        {canManage ? <Button type="button" onClick={() => openCreate()}><Plus className="size-4" />Create</Button> : null}
      </header>
      <section className="min-h-0 overflow-auto p-4">
        {error ? <TaskErrorState message={error} onDismiss={() => setError("")} /> : null}
        {loading && !tasks.length && !events.length ? <div className="grid h-full min-h-56 place-items-center text-muted-foreground"><LoaderCircle className="size-5 animate-spin" aria-label="Loading tasks" /></div>
          : view === "board" ? <SpaceTaskBoard tasks={visibleTasks.filter((task) => task.status !== "canceled")} members={members} totals={statusTotals} busy={busy} canManage={canManage} onOpen={openEdit} onMove={moveTask} onCreate={quickCreate} />
            : view === "list" ? <SpaceTaskList tasks={visibleTasks} members={members} busy={busy} canManage={canManage} onOpen={openEdit} onUpdate={updateTask} />
              : <SpaceTaskCalendar month={month} tasks={visibleTasks} events={events} members={members} onMonth={setMonth} onOpenTask={openEdit} onOpenEvent={setEventOpen} />}
        {nextCursor && view === "list" ? <Button className="mx-auto mt-4 flex" variant="outline" disabled={loading} type="button" onClick={() => void load(true)}>{loading ? <LoaderCircle className="size-4 animate-spin" /> : null}Load more</Button> : null}
      </section>
      {editing !== undefined ? <SpaceTaskDrawer draft={draft} setDraft={setDraft} editing={editing} members={members} busy={busy === "task" || busy === editing?.id} canManage={canManage} onClose={() => setEditing(undefined)} onSave={save} onArchive={editing ? () => void archive(editing) : undefined} /> : null}
      {eventOpen ? <SpaceTaskEventDrawer event={eventOpen} source={sources.find((item) => item.id === eventOpen.source_id)} onClose={() => setEventOpen(undefined)} /> : null}
      {sourceOpen ? <CalendarSourceDrawer integrations={integrations} selectedIntegration={selectedIntegration} choices={calendarChoices} sources={sources} busy={busy} onSelect={(id) => void loadCalendars(id)} onPublish={(choice) => void publishCalendar(choice)} onDisable={async (source) => {
        setBusy(source.id);
        try { await spacesApi.disableCalendarSource(spaceId, source.id); await load(false); }
        catch (reason) { setError(errorText(reason)); }
        finally { setBusy(""); }
      }} onClose={() => setSourceOpen(false)} /> : null}
    </div>
  );
}

function TaskFilters({ members, status, assignee, priority, due, mine, sort, onChange, onClear }: { members: SpaceMember[]; status: string; assignee: string; priority: string; due: string; mine: boolean; sort: string; onChange: (key: string, value?: string) => void; onClear: () => void }) {
  return <div className="grid gap-3" aria-label="Task filters">
    <div><h3 className="m-0 text-sm font-semibold">Filter tasks</h3><p className="mb-0 mt-1 text-xs text-muted-foreground">Narrow the current task view.</p></div>
    <div className="grid grid-cols-2 gap-2">
      <TaskFilterSelect label="Status" value={status} options={[["all","Any status"],["todo","To do"],["in_progress","In progress"],["done","Done"],["canceled","Canceled"]]} onChange={(value) => onChange("status", value)} />
      <TaskFilterSelect label="Assignee" value={assignee} options={[["all","Any assignee"],["unassigned","Unassigned"],...members.map((member) => [member.user_id,member.name] as [string,string])]} onChange={(value) => onChange("assignee", value)} />
      <TaskFilterSelect label="Priority" value={priority} options={[["all","Any priority"],["high","High"],["medium","Medium"],["low","Low"]]} onChange={(value) => onChange("priority", value)} />
      <TaskFilterSelect label="Due date" value={due} options={[["all","Any due date"],["overdue","Overdue"],["today","Today"],["week","Next 7 days"],["no_due","No due date"]]} onChange={(value) => onChange("due", value)} />
      <TaskFilterSelect label="Sort" value={sort} options={[["rank","Rank"],["due","Due date"],["updated","Updated"]]} onChange={(value) => onChange("sort", value)} />
      <label className="flex h-9 items-center gap-2 rounded-md border px-3 text-xs"><Checkbox checked={mine} onCheckedChange={(checked) => onChange("mine", checked === true ? "1" : undefined)} />Assigned to me</label>
    </div>
    <Button className="justify-self-end" size="sm" variant="ghost" type="button" onClick={onClear}>Clear filters</Button>
  </div>;
}

function TaskFilterSelect({ label, value, options, onChange }: { label: string; value: string; options: Array<[string,string]>; onChange: (value: string) => void }) {
  return <Select value={value} onValueChange={onChange}><SelectTrigger className="h-9 w-full text-xs" aria-label={label}><SelectValue /></SelectTrigger><SelectContent>{options.map(([id,name]) => <SelectItem value={id} key={id}>{name}</SelectItem>)}</SelectContent></Select>;
}

function localTimezone() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } }
function dueAtForRequest(value: string) { if (!value.trim()) return undefined; const dueAt = new Date(value); if (Number.isNaN(dueAt.getTime())) throw new Error("Enter a valid due date and time."); return dueAt.toISOString(); }
function createTaskInput(draft: TaskDraft, sourceRefs: SpaceTask["source_refs"] = []) { const assigneeUserId = draft.assignee_user_id.trim(); const dueAt = dueAtForRequest(draft.due_at); return { title: draft.title.trim(), notes: draft.notes.trim(), status: draft.status, priority: draft.priority, due_timezone: draft.due_timezone.trim() || "UTC", source_refs: sourceRefs, ...(assigneeUserId ? { assignee_user_id: assigneeUserId } : {}), ...(dueAt ? { due_at: dueAt } : {}) }; }
function normalizeView(value?: string): TaskViewMode { return value === "list" || value === "calendar" ? value : "board"; }
function taskDraft(task: SpaceTask): TaskDraft { return { title: task.title, notes: task.notes, status: task.status, priority: task.priority, assignee_user_id: task.assignee_user_id ?? "", due_at: task.due_at ? toLocalInput(task.due_at) : "", due_timezone: task.due_timezone || "UTC" }; }
function mergeTasks(current: SpaceTask[], incoming: SpaceTask[]) { const next = new Map(current.map((item) => [item.id, item])); incoming.forEach((item) => next.set(item.id, item)); return [...next.values()].sort((a, b) => a.status.localeCompare(b.status) || a.rank - b.rank || a.id.localeCompare(b.id)); }
function optimisticMove(tasks: SpaceTask[], id: string, status: SpaceTaskStatus, beforeId?: string) { const moving = tasks.find((item) => item.id === id); if (!moving) return tasks; const rest = tasks.filter((item) => item.id !== id); const column = rest.filter((item) => item.status === status).sort((a, b) => a.rank - b.rank); const index = beforeId ? Math.max(0, column.findIndex((item) => item.id === beforeId)) : column.length; column.splice(index, 0, { ...moving, status }); const ranked = new Map(column.map((item, itemIndex) => [item.id, { ...item, rank: (itemIndex + 1) * 1024 }])); return rest.map((item) => ranked.get(item.id) ?? item).concat(ranked.get(id) ?? moving); }
function activeFilterCount(params: URLSearchParams) { return ["status","assignee","priority","due","mine"].filter((key) => params.has(key)).length; }
function isTypingTarget(target: EventTarget | null) { return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable); }
function startOfMonth(date: Date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
function calendarRange(month: Date) { return { from: new Date(month.getFullYear(), month.getMonth()-1, 1), to: new Date(month.getFullYear(), month.getMonth()+2, 1) }; }
function filterDueRange(filter: DueFilter): { from?: string; to?: string } | undefined { const now = new Date(); if (filter === "overdue") return { to: now.toISOString() }; if (filter === "today") { const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()); const to = new Date(from); to.setDate(to.getDate()+1); return { from: from.toISOString(), to: to.toISOString() }; } if (filter === "week") { const to = new Date(now); to.setDate(to.getDate()+7); return { from: now.toISOString(), to: to.toISOString() }; } return undefined; }
function matchesDueFilter(task: SpaceTask, filter: DueFilter) { if (filter === "no_due") return !task.due_at; if (filter === "overdue") return Boolean(task.due_at && new Date(task.due_at) < new Date() && task.status !== "done" && task.status !== "canceled"); return true; }
