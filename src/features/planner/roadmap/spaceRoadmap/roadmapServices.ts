import type { createSpacePlannerExpansionApi } from "@/api/spaces/planner";

export type PlannerRoadmapServices = Omit<ReturnType<typeof createSpacePlannerExpansionApi>, "agenda">;
