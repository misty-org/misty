import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { DueFilter, TaskViewMode } from "@/models/types/features/spaces/SpaceTasksCalendar";
import type { SpaceTaskPriority, SpaceTaskStatus } from "@/models/types/features/spaces/types";
import { FILTER_PARAM_KEYS, activeFilterCount, filterDueRange } from "./taskFiltering";

export type TaskSort = "rank" | "due" | "updated";

/**
 * Task filters, read from and written back to the URL.
 *
 * The URL is the only source of truth here so a filtered view can be linked to
 * and survives a reload. `mine` overrides the assignee select rather than
 * combining with it, which is why `effectiveAssignee` is derived rather than read.
 */
export function useTaskFilterParams(options: {
  view: TaskViewMode;
  currentUserId: string | undefined;
}) {
  const [searchParams, setSearchParams] = useSearchParams();

  const query = searchParams.get("q") ?? "";
  const status = (searchParams.get("status") as SpaceTaskStatus | "all") || "all";
  const assignee = searchParams.get("assignee") ?? "all";
  const priority = (searchParams.get("priority") as SpaceTaskPriority | "all") || "all";
  const due = (searchParams.get("due") as DueFilter) || "all";
  const mine = searchParams.get("mine") === "1";
  const sort =
    (searchParams.get("sort") as TaskSort) || (options.view === "board" ? "rank" : "due");

  const updateParam = (key: string, value?: string) => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === "all" || value === "0") next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  const clearFilters = () => {
    const next = new URLSearchParams(searchParams);
    [...FILTER_PARAM_KEYS, "sort"].forEach((key) => next.delete(key));
    setSearchParams(next, { replace: true });
  };

  return {
    searchParams,
    query,
    status,
    assignee,
    priority,
    due,
    mine,
    sort,
    dueRange: useMemo(() => filterDueRange(due), [due]),
    effectiveAssignee: mine
      ? options.currentUserId || ""
      : assignee !== "all" && assignee !== "unassigned"
        ? assignee
        : "",
    activeFilterCount: activeFilterCount(searchParams),
    updateParam,
    clearFilters,
  };
}

export type TaskFilterParams = ReturnType<typeof useTaskFilterParams>;
