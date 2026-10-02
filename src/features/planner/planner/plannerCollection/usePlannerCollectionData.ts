import { useEffect, useRef, useState } from "react";
import { spacesApi } from "@/api/spaces/api";
import type { SpaceTask } from "@/api/spaces/dto/interfaces/types";
import type {
  SpaceAgendaEntry,
  SpaceRoadmap,
} from "@/api/spaces/dto/interfaces/plannerExpansionTypes";

export type TaskFilters = NonNullable<Parameters<typeof spacesApi.tasks>[1]>;
export type PlannerSection = "all" | "tasks" | "agenda" | "roadmaps";

/**
 * Loads the planner rows a section shows. Every result is tagged with the request that
 * asked for it, so a slow response never lands on a newer section or search.
 */
export function usePlannerCollectionData({
  spaceId,
  section,
  search,
  anchor,
  status,
  priority,
  sort,
}: {
  spaceId: string;
  section: PlannerSection;
  search: string;
  anchor: Date;
  status: TaskFilters["status"];
  priority: TaskFilters["priority"];
  sort: TaskFilters["sort"];
}) {
  const [tasks, setTasks] = useState<SpaceTask[]>([]);
  const [entries, setEntries] = useState<SpaceAgendaEntry[]>([]);
  const [roadmaps, setRoadmaps] = useState<SpaceRoadmap[]>([]);
  const [cursor, setCursor] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const request = useRef(0);
  const taskSearch = section === "tasks" || section === "all" ? search : "";
  const taskFilters = (): TaskFilters => ({
    limit: 100,
    search: taskSearch.trim() || undefined,
    status: section === "tasks" ? status : undefined,
    priority: section === "tasks" ? priority : undefined,
    sort: section === "tasks" ? sort : "updated",
  });
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
    const current = () => id === request.current;
    setLoading(true);
    setError("");
    setCursor("");
    setTasks([]);
    setEntries([]);
    setRoadmaps([]);
    const end = new Date(anchor);
    end.setDate(end.getDate() + 30);
    const loads: Promise<void>[] = [];
    if (section === "all" || section === "tasks")
      loads.push(
        spacesApi.tasks(spaceId, taskFilters()).then((result) => {
          if (!current()) return;
          setTasks(result.tasks);
          setCursor(result.next_cursor ?? "");
        }),
      );
    if (section === "all" || section === "agenda")
      loads.push(
        spacesApi
          .agenda(spaceId, anchor.toISOString(), end.toISOString())
          .then((result) => void (current() && setEntries(result.entries))),
      );
    if (section === "all" || section === "roadmaps")
      loads.push(
        spacesApi
          .roadmaps(spaceId)
          .then((result) => void (current() && setRoadmaps(result.roadmaps))),
      );
    void Promise.allSettled(loads).then((results) => {
      if (!current()) return;
      if (results.some((result) => result.status === "rejected"))
        setError("Some planner items couldn’t load.");
      setLoading(false);
    });
    return () => {
      request.current = id + 1;
    };
    // taskFilters reads only the values listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, section, revision, taskSearch, anchor, status, priority, sort]);
  const loadMore = async () => {
    const id = request.current;
    setLoading(true);
    try {
      const result = await spacesApi.tasks(spaceId, { ...taskFilters(), cursor });
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
  return {
    tasks,
    entries,
    roadmaps,
    cursor,
    loading,
    error,
    setError,
    request,
    reload: () => setRevision((n) => n + 1),
    loadMore,
  };
}
