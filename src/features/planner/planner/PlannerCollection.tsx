import { AccountCollectionFilters as CollectionFilters } from "@/features/settings/AccountCollectionFilters";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { MoreHorizontal, Plus } from "lucide-react";
import { spacesApi } from "@/api/spaces/api";
import { useSpaceItemCreator } from "@/features/spaces/useSpaceItemCreator";
import {
  Button,
  CollectionPage,
  CollectionHeading,
  CollectionSearch,
  useCollectionRefinement,
  CollectionItems,
  CollectionViewToggle,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  IconButton,
  Spinner,
  type CollectionItem,
} from "@/shared/ui";
import type { SpaceAgendaEntry } from "@/api/spaces/dto/interfaces/plannerExpansionTypes";
import { dayKey } from "./spaceAgenda/agendaDates";
import { NewCalendarEventDialog } from "./spaceAgenda/NewCalendarEventDialog";
import { agendaItem, roadmapItem, taskItem } from "./plannerCollection/PlannerCollectionItems";
import { PlannerTaskFilterMenu } from "./plannerCollection/PlannerTaskFilterMenu";
import {
  usePlannerCollectionData,
  type PlannerSection,
  type TaskFilters,
} from "./plannerCollection/usePlannerCollectionData";

export function PlannerCollection({ spaceId, canManage }: { spaceId: string; canManage: boolean }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const section = (
    ["all", "tasks", "agenda", "roadmaps"].includes(params.get("section") ?? "")
      ? params.get("section")!
      : "all"
  ) as PlannerSection;
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"list" | "grid">("list");
  const [statusFilter, setStatusFilter] = useState<TaskFilters["status"]>();
  const [priorityFilter, setPriorityFilter] = useState<TaskFilters["priority"]>();
  const [taskSort, setTaskSort] = useState<TaskFilters["sort"]>("rank");
  const [creating, setCreating] = useState(false);
  const [eventOpen, setEventOpen] = useState(false);
  const [eventError, setEventError] = useState("");
  const [anchor] = useState(() => new Date());
  const creator = useSpaceItemCreator(spaceId);
  const [search, setSearch] = useState(query);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const base = `/spaces/${encodeURIComponent(spaceId)}/planner`;
  const { tasks, entries, roadmaps, cursor, loading, error, setError, request, reload, loadMore } =
    usePlannerCollectionData({
      spaceId,
      section,
      search,
      anchor,
      status: statusFilter,
      priority: priorityFilter,
      sort: taskSort,
    });
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
  const taskItems = tasks.map((t) => taskItem(t, creator, () => openTask(t.id)));
  const agendaItems = (section === "all" ? entries : agendaRefinement.items).map((e) =>
    agendaItem(e, () => openAgenda(e)),
  );
  const roadmapItems = (section === "all" ? roadmaps : roadmapRefinement.items).map((r) =>
    roadmapItem(r, creator, () => navigate(`${base}/roadmaps/${encodeURIComponent(r.id)}`)),
  );
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
            <PlannerTaskFilterMenu
              status={statusFilter}
              priority={priorityFilter}
              sort={taskSort}
              onStatusChange={setStatusFilter}
              onPriorityChange={setPriorityFilter}
              onSortChange={setTaskSort}
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
          <Button variant="outline" size="sm" onClick={reload}>
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
          sortResetKey={`${section}:${
            section === "all"
              ? allRefinement.sortKey
              : section === "tasks"
                ? taskSort
                : section === "agenda"
                  ? agendaRefinement.sortKey
                  : roadmapRefinement.sortKey
          }`}
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
              reload();
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
