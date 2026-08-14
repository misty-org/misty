import { CollectionFilterMenu } from "@/shared/ui";
import type { TaskFilters } from "./usePlannerCollectionData";

export function PlannerTaskFilterMenu({
  status,
  priority,
  sort,
  onStatusChange,
  onPriorityChange,
  onSortChange,
}: {
  status: TaskFilters["status"];
  priority: TaskFilters["priority"];
  sort: TaskFilters["sort"];
  onStatusChange(value: TaskFilters["status"]): void;
  onPriorityChange(value: TaskFilters["priority"]): void;
  onSortChange(value: TaskFilters["sort"]): void;
}) {
  return (
    <CollectionFilterMenu
      label="Filter tasks"
      active={Boolean(status || priority || sort !== "rank")}
      onReset={() => {
        onStatusChange(undefined);
        onPriorityChange(undefined);
        onSortChange("rank");
      }}
      groups={[
        {
          label: "Status",
          value: status ?? "all",
          onChange: (value) =>
            onStatusChange(value === "all" ? undefined : (value as TaskFilters["status"])),
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
          value: priority ?? "all",
          onChange: (value) =>
            onPriorityChange(value === "all" ? undefined : (value as TaskFilters["priority"])),
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
          value: sort ?? "rank",
          onChange: (value) => onSortChange(value as TaskFilters["sort"]),
          options: [
            { value: "rank", label: "Task order" },
            { value: "updated", label: "Last activity" },
            { value: "due", label: "Due date" },
          ],
        },
      ]}
    />
  );
}
