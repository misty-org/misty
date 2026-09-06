import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { PlannerTaskRuntime, PlannerTaskIntegration } from "../spaceTasks/taskRuntime";
import type { PlannerCalendarServices, PlannerConnectionServices } from "./calendarServices";
import type { SpaceAgendaVisibility } from "@/features/spaces/store/useSpaceAgendaPreferences";

export interface PlannerCalendarRuntime extends Pick<
  PlannerTaskRuntime,
  "members" | "agents" | "subscribeChanges" | "renderError"
> {
  api: PlannerTaskRuntime["api"] & PlannerCalendarServices;
  connections: PlannerConnectionServices;
  visibility: SpaceAgendaVisibility;
  setVisibility: Dispatch<SetStateAction<SpaceAgendaVisibility>>;
  confirm(message: string, title?: string): Promise<boolean>;
  openAuthorization(url: string): Promise<void>;
  renderIntegration(input: Pick<PlannerTaskIntegration, "title" | "adapter">): ReactNode;
}
