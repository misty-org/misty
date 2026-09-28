import type { spacesApi } from "@/api/spaces/api";

export type PlannerTaskServices = Pick<
  typeof spacesApi,
  "tasks" | "createTask" | "updateTask" | "moveTask" | "archiveTask"
>;
