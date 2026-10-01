import { AccountCollectionFilters as CollectionFilters } from "@/features/settings/AccountCollectionFilters";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CalendarDays, Check, Clock3, Flag, MoreHorizontal, Plus } from "lucide-react";
import { spacesApi } from "@/api/spaces/api";
import { useSpaceItemCreator } from "@/features/spaces/useSpaceItemCreator";
import {
  Button,
  CollectionPage,
  CollectionHeading,
  CollectionSearch,
  CollectionFilterMenu,
  useCollectionRefinement,
  CollectionItems,
  CollectionViewToggle,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  IconButton,
  Spinner,
} from "@/shared/ui";
import type { CollectionItem } from "@/shared/ui/patterns/CollectionWorkspace";
import type { SpaceTask } from "@/api/spaces/dto/interfaces/types";
import type {
  SpaceAgendaEntry,
  SpaceRoadmap,
} from "@/api/spaces/dto/interfaces/plannerExpansionTypes";
import { dayKey } from "./spaceAgenda/agendaDates";
import { NewCalendarEventDialog } from "./spaceAgenda/NewCalendarEventDialog";

const date = (value?: string) =>
  value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—";
type TaskFilters = NonNullable<Parameters<typeof spacesApi.tasks>[1]>;
const taskStatus: Record<string, string> = {
  todo: "To do",
  open: "To do",
  in_progress: "In progress",
  done: "Completed",
  canceled: "Canceled",
  blocked: "Blocked",
};
export function PlannerCollection({ spaceId, canManage }: { spaceId: string; canManage: boolean }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const section = ["all", "tasks", "agenda", "roadmaps"].includes(params.get("section") ?? "")
    ? params.get("section")!
    : "all";
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"list" | "grid">("list");
  const [statusFilter, setStatusFilter] = useState<TaskFilters["status"]>();
  const [priorityFilter, setPriorityFilter] = useState<TaskFilters["priority"]>();
  const [taskSort, setTaskSort] = useState<TaskFilters["sort"]>("rank");
  const resetTaskFilters = () => {
    setStatusFilter(undefined);
    setPriorityFilter(undefined);
    setTaskSort("rank");
  };
  const taskFiltersActive = Boolean(statusFilter || priorityFilter || taskSort !== "rank");
  const [tasks, setTasks] = useState<SpaceTask[]>([]);
  const [entries, setEntries] = useState<SpaceAgendaEntry[]>([]);
  const [roadmaps, setRoadmaps] = useState<SpaceRoadmap[]>([]);
  const [cursor, setCursor] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [creating, setCreating] = useState(false);
  const [eventOpen, setEventOpen] = useState(false);
  const [eventError, setEventError] = useState("");
  const [anchor] = useState(() => new Date());
  const request = useRef(0);
  const creator = useSpaceItemCreator(spaceId);
  const [search, setSearch] = useState(query);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const taskSearch = section === "tasks" || section === "all" ? search : "";
  const base = `/spaces/${encodeURIComponent(spaceId)}/planner`;
  useEffect(() => {
    const receive = (event: Event) => {
      if ((event as CustomEvent<{ space_id?: string }>).detail?.space_id === spaceId)
        setRevision((n) => n + 1);
    };
    window.addEventListener("misty:space-coordination-event", receive);
    return () => window.removeEventListener("misty:space-coordination-event", receive);
  }, [spaceId]);
  useEffect(() => {
    const id = ++request.current;
    setLoading(true);
    setError("");
    setCursor("");
    setTasks([]);
    setEntries([]);
    setRoadmaps([]);
    const end = new Date(anchor);
    end.setDate(end.getDate() + 30);
    const load = async () => {
      try {
        const results = await Promise.allSettled([
          ...(section === "all" || section === "tasks"
            ? [
                (async () => {
                  const result = await spacesApi.tasks(spaceId, {
                    limit: 100,
                    search: taskSearch.trim() || undefined,
                    status: section === "tasks" ? statusFilter : undefined,
                    priority: section === "tasks" ? priorityFilter : undefined,
                    sort: section === "tasks" ? taskSort : "updated",
                  });
                  if (id === request.current) {
                    setTasks(result.tasks);
                    setCursor(result.next_cursor ?? "");
                  }
                })(),
              ]
            : []),
          ...(section === "all" || section === "agenda"
            ? [
                (async () => {
                  const result = await spacesApi.agenda(
                    spaceId,
                    anchor.toISOString(),
                    end.toISOString(),
                  );
                  if (id === request.current) setEntries(result.entries);
                })(),
              ]
            : []),
          ...(section === "all" || section === "roadmaps"
            ? [
                (async () => {
                  const result = await spacesApi.roadmaps(spaceId);
                  if (id === request.current) setRoadmaps(result.roadmaps);
                })(),
              ]
            : []),
        ]);
        if (results.some((result) => result.status === "rejected"))
          throw new Error("Some planner items couldn’t load.");
      } catch (reason) {
        if (id === request.current)
          setError(reason instanceof Error ? reason.message : "Planner could not be loaded.");
      } finally {
        if (id === request.current) setLoading(false);
      }
    };
    void load();
    return () => {
      request.current = id + 1;
    };
  }, [spaceId, section, revision, taskSearch, anchor, statusFilter, priorityFilter, taskSort]);
  const openTask = (id: string) => navigate(`${base}/tasks/list?task=${encodeURIComponent(id)}`);
  const openAgenda = (entry: SpaceAgendaEntry) =>
    navigate(
      `${base}/agenda/day?date=${dayKey(new Date(entry.starts_at))}&entry=${encodeURIComponent(entry.id)}`,
    );
  const agendaRefinement = useCollectionRefinement(entries, {
    label: "Filter agenda",
    title: (entry) => entry.title,
    date: (entry) => entry.starts_at,
    dateWindow: false,
    defaultOrderLabel: "Soonest first",
    facet: {
      label: "Event time",
      value: (entry) => (entry.all_day ? "all-day" : "timed"),
      options: [
        { value: "all", label: "All events" },
        { value: "all-day", label: "All day" },
        { value: "timed", label: "Timed" },
      ],
    },
  });
  const roadmapRefinement = useCollectionRefinement(roadmaps, {
    label: "Filter roadmaps",
    title: (roadmap) => roadmap.name,
    date: (roadmap) => roadmap.updated_at,
    facet: {
      label: "Status",
      value: (roadmap) => (roadmap.archived_at ? "archived" : "active"),
      options: [
        { value: "all", label: "All roadmaps" },
        { value: "active", label: "Active" },
        { value: "archived", label: "Archived" },
      ],
    },
  });
  const taskItems: CollectionItem[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    icon: t.status === "done" ? <Check /> : <Clock3 />,
    category: taskStatus[t.status] ?? t.status,
    creator: creator(t.created_by_user_id, t.created_by_agent_id),
    metadata: {
      Status: taskStatus[t.status] ?? t.status,
      Priority: t.priority ? t.priority.charAt(0).toUpperCase() + t.priority.slice(1) : "—",
      "Assigned to":
        t.assignee_user_id || t.assignee_agent_id
          ? creator(t.assignee_user_id, t.assignee_agent_id)
          : "Unassigned",
      Due: date(t.due_at),
      Created: date(t.created_at),
    },
    sortValues: {
      Priority: { low: 1, medium: 2, high: 3 }[t.priority],
      Due: t.due_at ? Date.parse(t.due_at) : undefined,
      Created: Date.parse(t.created_at),
    },
    updatedAt: t.updated_at,
    updated: date(t.updated_at),
    onOpen: () => openTask(t.id),
  }));
  const agendaItems: CollectionItem[] = (section === "all" ? entries : agendaRefinement.items).map(
    (e) => ({
      id: e.id,
      title: e.title,
      icon: <CalendarDays />,
      category: new Date(e.starts_at).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
      metadata: {
        Ends: e.ends_at
          ? new Date(e.ends_at).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })
          : "—",
        "Time zone": e.timezone,
        Location: e.location || "—",
        Status: e.status || "—",
      },
      sortValues: {
        category: Date.parse(e.starts_at),
        Ends: e.ends_at ? Date.parse(e.ends_at) : undefined,
      },
      updated: "—",
      onOpen: () => openAgenda(e),
    }),
  );
  const roadmapItems: CollectionItem[] = (
    section === "all" ? roadmaps : roadmapRefinement.items
  ).map((r) => ({
    id: r.id,
    title: r.name,
    icon: <Flag />,
    category: r.archived_at ? "Archived" : "Roadmap",
    creator: creator(r.created_by_user_id),
    metadata: {
      Status: r.archived_at ? "Archived" : "Active",
      Audience: r.audience_kind === "conversation" ? "Conversation" : "Space",
      Created: date(r.created_at),
    },
    sortValues: { Created: Date.parse(r.created_at) },
    updatedAt: r.updated_at,
    updated: date(r.updated_at),
    onOpen: () => navigate(`${base}/roadmaps/${encodeURIComponent(r.id)}`),
  }));
  const allRefinement = useCollectionRefinement(
    [
      ...taskItems.map((item) => ({ ...item, id: `task:${item.id}`, category: "Task" })),
      ...agendaItems.map((item) => ({ ...item, id: `event:${item.id}`, category: "Event" })),
      ...roadmapItems.map((item) => ({ ...item, id: `roadmap:${item.id}`, category: "Roadmap" })),
    ],
    { label: "Filter planner", title: (item) => item.title, date: (item) => item.updatedAt ?? "" },
  );
  let items: CollectionItem[] =
    section === "all"
      ? allRefinement.items
      : section === "tasks"
        ? taskItems
        : section === "agenda"
          ? agendaItems
          : roadmapItems;

  items = items
    .filter((i) => i.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .map((i) => ({
      ...i,
      actions: (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label={`More actions for ${i.title}`}>
              <MoreHorizontal />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={i.onOpen}>Open</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    }));
  const create = async () => {
    if (!canManage || creating) return;
    if (section === "tasks" || section === "all") {
      navigate(`${base}/tasks/list?create=task`);
      return;
    }
    if (section === "agenda") {
      setEventError("");
      setEventOpen(true);
      return;
    }
    const id = request.current;
    setCreating(true);
    setError("");
    try {
      const graph = await spacesApi.createRoadmap(spaceId, "Untitled roadmap");
      if (id === request.current)
        navigate(`${base}/roadmaps/${encodeURIComponent(graph.roadmap.id)}`);
    } catch (reason) {
      if (id === request.current)
        setError(reason instanceof Error ? reason.message : "Roadmap could not be created.");
    } finally {
      setCreating(false);
    }
  };
  const loadMore = async () => {
    const id = request.current;
    setLoading(true);
    try {
      const result = await spacesApi.tasks(spaceId, {
        limit: 100,
        cursor,
        search: taskSearch.trim() || undefined,
        status: section === "tasks" ? statusFilter : undefined,
        priority: section === "tasks" ? priorityFilter : undefined,
        sort: section === "tasks" ? taskSort : "updated",
      });
      if (id === request.current) {
        setTasks((old) => [...old, ...result.tasks]);
        setCursor(result.next_cursor ?? "");
      }
    } catch (reason) {
      if (id === request.current)
        setError(reason instanceof Error ? reason.message : "Tasks could not be loaded.");
    } finally {
      if (id === request.current) setLoading(false);
    }
  };
  return (
    <CollectionPage>
      <CollectionHeading
        title="Planner"
        actions={
          <>
            <CollectionSearch
              aria-label="Search planner"
              placeholder="Search planner"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {canManage && (
              <Button
                variant="primary"
                className="px-4"
                disabled={creating}
                onClick={() => void create()}
              >
                <Plus />
                {section === "tasks" || section === "all"
                  ? "New task"
                  : section === "agenda"
                    ? "New event"
                    : "New roadmap"}
              </Button>
            )}
          </>
        }
      />
      <CollectionFilters
        collectionId="planner"
        options={[
          { value: "all", label: "All" },
          { value: "tasks", label: "Tasks" },
          { value: "agenda", label: "Agenda" },
          { value: "roadmaps", label: "Roadmaps" },
        ]}
        value={section}
        onChange={(value) => {
          setQuery("");
          setParams(value === "all" ? {} : { section: value });
        }}
        filterControl={
          section === "all" ? (
            allRefinement.control
          ) : section === "tasks" ? (
            <CollectionFilterMenu
              label="Filter tasks"
              active={taskFiltersActive}
              onReset={resetTaskFilters}
              groups={[
                {
                  label: "Status",
                  value: statusFilter ?? "all",
                  onChange: (value) =>
                    setStatusFilter(value === "all" ? undefined : (value as TaskFilters["status"])),
                  options: [
                    { value: "all", label: "All statuses" },
                    { value: "todo", label: "To do" },
                    { value: "in_progress", label: "In progress" },
                    { value: "done", label: "Completed" },
                    { value: "canceled", label: "Canceled" },
                  ],
                },
                {
                  label: "Priority",
                  submenu: true,
                  value: priorityFilter ?? "all",
                  onChange: (value) =>
                    setPriorityFilter(
                      value === "all" ? undefined : (value as TaskFilters["priority"]),
                    ),
                  options: [
                    { value: "all", label: "All priorities" },
                    { value: "high", label: "High" },
                    { value: "medium", label: "Medium" },
                    { value: "low", label: "Low" },
                  ],
                },
                {
                  label: "Sort by",
                  kind: "sort",
                  submenu: true,
                  value: taskSort ?? "rank",
                  onChange: (value) => setTaskSort(value as TaskFilters["sort"]),
                  options: [
                    { value: "rank", label: "Task order" },
                    { value: "updated", label: "Last activity" },
                    { value: "due", label: "Due date" },
                  ],
                },
              ]}
            />
          ) : section === "agenda" ? (
            agendaRefinement.control
          ) : (
            roadmapRefinement.control
          )
        }
        actions={
          <>
            {section === "agenda" && (
              <Button variant="outline" onClick={() => navigate(`${base}/agenda/month`)}>
                Calendar
              </Button>
            )}
            <CollectionViewToggle
              value={view}
              onChange={setView}
              onBoardView={section === "tasks" ? () => navigate(`${base}/tasks/board`) : undefined}
            />
          </>
        }
      />
      {error && (
        <div role="alert" className="flex items-center gap-3 text-sm">
          {error}
          <Button variant="outline" size="sm" onClick={() => setRevision((n) => n + 1)}>
            Retry
          </Button>
        </div>
      )}
      {loading && !items.length ? (
        <Spinner label="Loading planner" />
      ) : (
        <CollectionItems
          columnSetId={`planner:${section}`}
          showLastActivity={section !== "agenda"}
          fields={
            section === "all"
              ? ["Status", "Created"]
              : section === "tasks"
                ? ["Priority", "Assigned to", "Due", "Created"]
                : section === "agenda"
                  ? ["Ends", "Time zone", "Location", "Status"]
                  : ["Audience", "Created"]
          }
          sortResetKey={`${section}:${section === "all" ? allRefinement.sortKey : section === "tasks" ? taskSort : section === "agenda" ? agendaRefinement.sortKey : roadmapRefinement.sortKey}`}
          items={items}
          view={view}
          categoryLabel={section === "agenda" ? "When" : section === "tasks" ? "Status" : "Type"}
        />
      )}
      {cursor && (section === "tasks" || section === "all") && (
        <Button
          variant="outline"
          className="mx-auto"
          disabled={loading}
          onClick={() => void loadMore()}
        >
          Load more
        </Button>
      )}
      <NewCalendarEventDialog
        open={eventOpen}
        anchor={anchor}
        busy={creating}
        error={eventError}
        onOpenChange={(open) => !creating && setEventOpen(open)}
        onCreate={(input) => {
          if (!canManage || creating) return;
          const id = request.current;
          setCreating(true);
          setEventError("");
          void spacesApi
            .createCalendarEvent(spaceId, input)
            .then(() => {
              if (id !== request.current) return;
              setEventOpen(false);
              setRevision((n) => n + 1);
            })
            .catch(
              (reason) =>
                id === request.current &&
                setEventError(
                  reason instanceof Error ? reason.message : "Event could not be created.",
                ),
            )
            .finally(() => setCreating(false));
        }}
      />
    </CollectionPage>
  );
}
