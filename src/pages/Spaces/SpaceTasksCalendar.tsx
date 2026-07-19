import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { CalendarDays, Filter, KanbanSquare, List, LoaderCircle, Plus, RefreshCcw, Search, X } from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { confirmAction } from "../../shared/confirmAction";
import { errorText } from "../../shared/format";
import { agentArchitectureApi } from "../../spaces/agentArchitectureApi";
import { spacesApi } from "../../spaces/api";
import type { GoogleCalendarChoice, SpaceCalendarEvent, SpaceCalendarSource, SpaceIntegration, SpaceMember, SpaceTask, SpaceTaskPriority, SpaceTaskStatus } from "../../spaces/types";
import { useSpacesStore } from "../../stores/useSpacesStore";
import { CalendarSourceDrawer, SpaceTaskBoard, SpaceTaskCalendar, SpaceTaskDrawer, SpaceTaskEventDrawer, SpaceTaskList, type TaskDraft } from "./SpaceTasksViews";

export type TaskViewMode = "board" | "list" | "calendar";
export type DueFilter = "all" | "overdue" | "today" | "week" | "no_due";

const emptyMembers: SpaceMember[] = [];
const emptyDraft = (): TaskDraft => ({ title: "", notes: "", status: "todo", priority: "medium", assignee_user_id: "", due_at: "", due_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" });

export function SpaceTasksCalendar({ spaceId, canManage, canManageIntegrations }: { spaceId: string; canManage: boolean; canManageIntegrations: boolean }) {
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
  const sort = (searchParams.get("sort") as "rank" | "due" | "updated") || (view === "board" ? "rank" : "due");
  const range = useMemo(() => calendarRange(month), [month]);
  const dueRange = useMemo(() => filterDueRange(due), [due]);
  const effectiveAssignee = mine ? user?.id || "" : assignee !== "all" && assignee !== "unassigned" ? assignee : "";

  const updateParam = (key: string, value?: string) => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === "all" || value === "0") next.delete(key); else next.set(key, value);
    setSearchParams(next, { replace: true });
  };
  const changeView = (next: TaskViewMode) => navigate(`/spaces/${encodeURIComponent(spaceId)}/tasks/${next}${searchParams.size ? `?${searchParams}` : ""}`);

  const load = useCallback(async (append = false) => {
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
        view === "calendar" ? spacesApi.calendarEvents(spaceId, range.from.toISOString(), range.to.toISOString()) : Promise.resolve({ events: [] as SpaceCalendarEvent[] }),
      ]);
      setTasks((current) => append ? mergeTasks(current, taskResult.tasks) : taskResult.tasks);
      setNextCursor(taskResult.next_cursor ?? "");
      setStatusTotals(taskResult.status_totals ?? {});
      setSources(sourceResult.sources);
      setIntegrations(integrationResult.integrations.filter((item) => item.provider === "google"));
      setEvents(eventResult.events);
      setError("");
    } catch (reason) { setError(errorText(reason)); }
    finally { setLoading(false); }
  }, [dueRange?.from, dueRange?.to, effectiveAssignee, nextCursor, priority, query, range.from, range.to, sort, spaceId, status, view]);

  useEffect(() => { void load(false); }, [dueRange?.from, dueRange?.to, effectiveAssignee, priority, query, range.from, range.to, sort, spaceId, status, view]);
  useEffect(() => {
    const reload = (event: Event) => { if ((event as CustomEvent<{ space_id?: string }>).detail?.space_id === spaceId) void load(false); };
    window.addEventListener("misty:space-coordination-event", reload);
    return () => window.removeEventListener("misty:space-coordination-event", reload);
  }, [load, spaceId]);
  useEffect(() => {
    const openCreateShortcut = (event: KeyboardEvent) => {
      if (!canManage || event.key.toLowerCase() !== "c" || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      event.preventDefault(); openCreate();
    };
    window.addEventListener("keydown", openCreateShortcut);
    return () => window.removeEventListener("keydown", openCreateShortcut);
  });

  const visibleTasks = tasks.filter((task) => !(assignee === "unassigned" && task.assignee_user_id) && matchesDueFilter(task, due));
  const openCreate = (initialStatus: SpaceTaskStatus = "todo") => { setDraft({ ...emptyDraft(), status: initialStatus }); setEditing(null); };
  const openEdit = (task: SpaceTask) => { setDraft(taskDraft(task)); setEditing(task); };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage || !draft.title.trim()) return;
    setBusy("task");
    try {
      const patch = { ...draft, title: draft.title.trim(), notes: draft.notes.trim(), due_at: draft.due_at ? new Date(draft.due_at).toISOString() : undefined, source_refs: editing?.source_refs ?? [] };
      const saved = editing ? await spacesApi.updateTask(spaceId, editing, patch) : await spacesApi.createTask(spaceId, patch);
      setTasks((current) => mergeTasks(current, [saved])); setEditing(undefined); setError("");
    } catch (reason) { setError(errorText(reason)); } finally { setBusy(""); }
  };
  const quickCreate = async (title: string, initialStatus: SpaceTaskStatus) => {
    if (!canManage || !title.trim()) return;
    setBusy(`create:${initialStatus}`);
    try { const saved = await spacesApi.createTask(spaceId, { ...emptyDraft(), title: title.trim(), status: initialStatus }); setTasks((current) => mergeTasks(current, [saved])); }
    catch (reason) { setError(errorText(reason)); } finally { setBusy(""); }
  };
  const updateTask = async (task: SpaceTask, patch: Partial<Pick<SpaceTask, "title" | "notes" | "status" | "priority" | "assignee_user_id" | "due_at" | "due_timezone">>) => {
    setBusy(task.id);
    try { const saved = await spacesApi.updateTask(spaceId, task, patch); setTasks((current) => mergeTasks(current, [saved])); return saved; }
    catch (reason) { setError(errorText(reason)); return undefined; } finally { setBusy(""); }
  };
  const moveTask = async (task: SpaceTask, nextStatus: SpaceTaskStatus, beforeTaskId?: string) => {
    if (!canManage) return;
    const previous = tasks;
    setTasks((current) => optimisticMove(current, task.id, nextStatus, beforeTaskId)); setBusy(task.id);
    try { const result = await spacesApi.moveTask(spaceId, task, nextStatus, beforeTaskId); setTasks((current) => mergeTasks(current, result.reordered.length ? result.reordered : [result.task])); }
    catch (reason) { setTasks(previous); setError(errorText(reason)); } finally { setBusy(""); }
  };
  const archive = async (task: SpaceTask) => {
    if (!await confirmAction(`Archive “${task.title}”?`)) return;
    setBusy(task.id);
    try { await spacesApi.archiveTask(spaceId, task); setTasks((current) => current.filter((item) => item.id !== task.id)); setEditing(undefined); }
    catch (reason) { setError(errorText(reason)); } finally { setBusy(""); }
  };
  const loadCalendars = async (integrationId: string) => {
    setSelectedIntegration(integrationId); setCalendarChoices([]);
    if (!integrationId) return;
    setBusy("calendars");
    try { setCalendarChoices((await spacesApi.googleCalendars(spaceId, integrationId)).calendars); }
    catch (reason) { setError(errorText(reason)); } finally { setBusy(""); }
  };
  const publishCalendar = async (calendar: GoogleCalendarChoice) => {
    if (!selectedIntegration) return;
    setBusy(calendar.id);
    try { await spacesApi.publishGoogleCalendar(spaceId, selectedIntegration, calendar); await load(false); }
    catch (reason) { setError(errorText(reason)); } finally { setBusy(""); }
  };

  return <main className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-[var(--misty-app-page-bg,var(--misty-bg))]">
    <header className="flex min-h-14 flex-wrap items-center gap-2 border-b border-[var(--misty-border-soft)] px-4 py-2">
      <nav className="flex rounded-lg bg-[var(--misty-surface-2)] p-0.5" aria-label="Task views"><ViewButton active={view === "board"} icon={KanbanSquare} label="Board" onClick={() => changeView("board")}/><ViewButton active={view === "list"} icon={List} label="List" onClick={() => changeView("list")}/><ViewButton active={view === "calendar"} icon={CalendarDays} label="Calendar" onClick={() => changeView("calendar")}/></nav>
      <label className="flex min-h-8 min-w-44 flex-1 items-center gap-2 rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-surface)] px-2.5"><Search size={13}/><input className="min-w-0 flex-1 border-0 bg-transparent text-[11px] outline-none" placeholder="Search tasks" value={query} onChange={(event) => updateParam("q", event.target.value)}/>{query ? <button className="border-0 bg-transparent p-0" type="button" onClick={() => updateParam("q")} aria-label="Clear search"><X size={12}/></button> : null}</label>
      {members.length ? <div className="flex -space-x-1" aria-label="Filter by assignee">{members.slice(0, 5).map((member) => { const selected = assignee === member.user_id || mine && member.user_id === user?.id; return <button className={`grid size-7 place-items-center rounded-full border text-[8px] font-semibold ${selected ? "z-10 border-sky-300 bg-sky-500/20 text-sky-100" : "border-[var(--misty-surface)] bg-[var(--misty-surface-3)] text-[var(--misty-text-muted)]"}`} type="button" title={member.name} aria-label={`Filter by ${member.name}`} aria-pressed={selected} key={member.user_id} onClick={() => { const next = new URLSearchParams(searchParams); next.delete("mine"); if (selected) next.delete("assignee"); else next.set("assignee", member.user_id); setSearchParams(next, { replace: true }); }}>{memberInitials(member.name)}</button>; })}</div> : null}
      <button className={`${secondaryButton} ${filtersOpen ? "bg-[var(--misty-surface-3)] text-[var(--misty-text)]" : ""}`} type="button" onClick={() => setFiltersOpen((open) => !open)} aria-expanded={filtersOpen}><Filter size={13}/>Filter{activeFilterCount(searchParams) ? <span className="rounded-full bg-[var(--misty-primary)] px-1.5 text-[8px] text-[var(--misty-primary-contrast)]">{activeFilterCount(searchParams)}</span> : null}</button>
      {canManageIntegrations ? <button className={iconButton} type="button" onClick={() => setSourceOpen(true)} aria-label="Calendars" title="Calendars"><CalendarDays size={14}/>{sources.some((source) => source.status !== "active") ? <span className="absolute right-1 top-1 size-1.5 rounded-full bg-amber-400"/> : null}</button> : null}
      <button className={iconButton} type="button" onClick={() => void load(false)} aria-label="Refresh tasks" title="Refresh"><RefreshCcw className={loading ? "animate-spin" : ""} size={14}/></button>
      {canManage ? <button className={primaryButton} type="button" onClick={() => openCreate()}><Plus size={13}/>Create</button> : null}
    </header>
    {filtersOpen ? <TaskFilters members={members} status={status} assignee={assignee} priority={priority} due={due} mine={mine} sort={sort} onChange={updateParam} onClear={() => { const next = new URLSearchParams(searchParams); ["status","assignee","priority","due","mine","sort"].forEach((key) => next.delete(key)); setSearchParams(next, { replace: true }); setFiltersOpen(false); }}/> : null}
    <section className="min-h-0 overflow-auto p-4">
      {error ? <button className="mb-3 w-full rounded-lg border border-red-400/20 bg-red-950/20 px-3 py-2 text-left text-[11px] text-red-200" type="button" onClick={() => setError("")}>{error}</button> : null}
      {loading && !tasks.length && !events.length ? <div className="grid h-full place-items-center"><LoaderCircle className="animate-spin text-[var(--misty-text-subtle)]" size={18}/></div> : view === "board" ? <SpaceTaskBoard tasks={visibleTasks.filter((task) => task.status !== "canceled")} members={members} totals={statusTotals} busy={busy} canManage={canManage} onOpen={openEdit} onMove={moveTask} onCreate={quickCreate}/> : view === "list" ? <SpaceTaskList tasks={visibleTasks} members={members} busy={busy} canManage={canManage} onOpen={openEdit} onUpdate={updateTask}/> : <SpaceTaskCalendar month={month} tasks={visibleTasks} events={events} members={members} onMonth={setMonth} onOpenTask={openEdit} onOpenEvent={setEventOpen}/>} 
      {nextCursor && view === "list" ? <button className={`${secondaryButton} mx-auto mt-4 flex`} disabled={loading} type="button" onClick={() => void load(true)}>{loading ? <LoaderCircle className="animate-spin" size={13}/> : null}Load more</button> : null}
    </section>
    {editing !== undefined ? <SpaceTaskDrawer draft={draft} setDraft={setDraft} editing={editing} members={members} busy={busy === "task" || busy === editing?.id} canManage={canManage} onClose={() => setEditing(undefined)} onSave={save} onArchive={editing ? () => void archive(editing) : undefined}/> : null}
    {eventOpen ? <SpaceTaskEventDrawer event={eventOpen} source={sources.find((item) => item.id === eventOpen.source_id)} onClose={() => setEventOpen(undefined)}/> : null}
    {sourceOpen ? <CalendarSourceDrawer integrations={integrations} selectedIntegration={selectedIntegration} choices={calendarChoices} sources={sources} busy={busy} onSelect={(id) => void loadCalendars(id)} onPublish={(choice) => void publishCalendar(choice)} onDisable={async (source) => { setBusy(source.id); try { await spacesApi.disableCalendarSource(spaceId, source.id); await load(false); } catch (reason) { setError(errorText(reason)); } finally { setBusy(""); } }} onClose={() => setSourceOpen(false)}/> : null}
  </main>;
}

function TaskFilters({ members, status, assignee, priority, due, mine, sort, onChange, onClear }: { members: SpaceMember[]; status: string; assignee: string; priority: string; due: string; mine: boolean; sort: string; onChange: (key: string, value?: string) => void; onClear: () => void }) {
  return <div className="flex flex-wrap items-center gap-2 border-b border-[var(--misty-border-soft)] bg-[var(--misty-surface)] px-4 py-2" aria-label="Task filters"><select className={filterInput} value={status} onChange={(event) => onChange("status", event.target.value)} aria-label="Status"><option value="all">Status</option><option value="todo">To do</option><option value="in_progress">In progress</option><option value="done">Done</option><option value="canceled">Canceled</option></select><select className={filterInput} value={assignee} onChange={(event) => onChange("assignee", event.target.value)} aria-label="Assignee"><option value="all">Assignee</option><option value="unassigned">Unassigned</option>{members.map((member) => <option value={member.user_id} key={member.user_id}>{member.name}</option>)}</select><select className={filterInput} value={priority} onChange={(event) => onChange("priority", event.target.value)} aria-label="Priority"><option value="all">Priority</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select><select className={filterInput} value={due} onChange={(event) => onChange("due", event.target.value)} aria-label="Due date"><option value="all">Due</option><option value="overdue">Overdue</option><option value="today">Today</option><option value="week">Next 7 days</option><option value="no_due">No due date</option></select><select className={filterInput} value={sort} onChange={(event) => onChange("sort", event.target.value)} aria-label="Sort"><option value="rank">Rank</option><option value="due">Due date</option><option value="updated">Updated</option></select><label className={`${filterInput} flex items-center gap-2`}><input type="checkbox" checked={mine} onChange={(event) => onChange("mine", event.target.checked ? "1" : undefined)}/>Mine</label><button className={secondaryButton} type="button" onClick={onClear}>Clear</button></div>;
}

function ViewButton({ active, icon: Icon, label, onClick }: { active: boolean; icon: typeof List; label: string; onClick: () => void }) { return <button className={`inline-flex min-h-8 items-center gap-1.5 rounded-md border-0 px-2.5 text-[10px] ${active ? "bg-[var(--misty-surface-3)] text-[var(--misty-text)] shadow-sm" : "bg-transparent text-[var(--misty-text-muted)]"}`} type="button" onClick={onClick} aria-current={active ? "page" : undefined}><Icon size={12}/>{label}</button>; }
function normalizeView(value?: string): TaskViewMode { return value === "list" || value === "calendar" ? value : "board"; }
function taskDraft(task: SpaceTask): TaskDraft { return { title: task.title, notes: task.notes, status: task.status, priority: task.priority, assignee_user_id: task.assignee_user_id ?? "", due_at: task.due_at ? toLocalInput(task.due_at) : "", due_timezone: task.due_timezone || "UTC" }; }
function mergeTasks(current: SpaceTask[], incoming: SpaceTask[]) { const next = new Map(current.map((item) => [item.id, item])); incoming.forEach((item) => next.set(item.id, item)); return [...next.values()].sort((a, b) => a.status.localeCompare(b.status) || a.rank - b.rank || a.id.localeCompare(b.id)); }
function optimisticMove(tasks: SpaceTask[], id: string, status: SpaceTaskStatus, beforeId?: string) { const moving = tasks.find((item) => item.id === id); if (!moving) return tasks; const rest = tasks.filter((item) => item.id !== id); const column = rest.filter((item) => item.status === status).sort((a, b) => a.rank - b.rank); const index = beforeId ? Math.max(0, column.findIndex((item) => item.id === beforeId)) : column.length; column.splice(index, 0, { ...moving, status }); const ranked = new Map(column.map((item, itemIndex) => [item.id, { ...item, rank: (itemIndex + 1) * 1024 }])); return rest.map((item) => ranked.get(item.id) ?? item).concat(ranked.get(id) ?? moving); }
function activeFilterCount(params: URLSearchParams) { return ["status","assignee","priority","due","mine"].filter((key) => params.has(key)).length; }
function memberInitials(name: string) { return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?"; }
function isTypingTarget(target: EventTarget | null) { return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable); }
function startOfMonth(date: Date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
function calendarRange(month: Date) { return { from: new Date(month.getFullYear(), month.getMonth()-1, 1), to: new Date(month.getFullYear(), month.getMonth()+2, 1) }; }
function filterDueRange(filter: DueFilter): { from?: string; to?: string } | undefined { const now = new Date(); if (filter === "overdue") return { to: now.toISOString() }; if (filter === "today") { const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()); const to = new Date(from); to.setDate(to.getDate()+1); return { from: from.toISOString(), to: to.toISOString() }; } if (filter === "week") { const to = new Date(now); to.setDate(to.getDate()+7); return { from: now.toISOString(), to: to.toISOString() }; } return undefined; }
function matchesDueFilter(task: SpaceTask, filter: DueFilter) { if (filter === "no_due") return !task.due_at; if (filter === "overdue") return Boolean(task.due_at && new Date(task.due_at) < new Date() && task.status !== "done" && task.status !== "canceled"); return true; }
function toLocalInput(value: string) { const date = new Date(value); return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16); }

const filterInput = "min-h-8 rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-surface-2)] px-2.5 text-[10px] outline-none";
const primaryButton = "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border-0 bg-[var(--misty-primary)] px-3 text-[10px] font-semibold text-[var(--misty-primary-contrast)] disabled:opacity-50";
const secondaryButton = "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-surface)] px-2.5 text-[10px] text-[var(--misty-text-muted)] disabled:opacity-50";
const iconButton = "relative grid size-8 place-items-center rounded-lg border border-[var(--misty-border-soft)] bg-[var(--misty-surface)] text-[var(--misty-text-muted)]";
