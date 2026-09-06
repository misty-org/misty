import type { ReactNode } from "react";
import type { MistySurfaceAdapter } from "@misty/sdk";
import type { SpaceAgentMembership, SpaceMember } from "@/api/spaces/dto/interfaces/types";
import type { PlannerTaskServices } from "./taskServices";

export interface PlannerTaskIntegration {
  title: string;
  adapter: MistySurfaceAdapter;
  canCreate: boolean;
  onCreate(): void;
}
export interface PlannerTaskRuntime {
  api: PlannerTaskServices;
  userId?: string;
  members: SpaceMember[];
  agents: SpaceAgentMembership[];
  subscribeChanges(listener: () => void): () => void;
  renderIntegration(input: PlannerTaskIntegration): ReactNode;
  renderError(message: string): ReactNode;
}
