import type { ComponentType } from "react";
import { createPort } from "@/shared/lib/seams";

export type AgentSurfaceTour = "agent-settings" | "add-sources";

export const tourCorner = createPort<ComponentType<{ tour: AgentSurfaceTour }>>("Tour corner");

export function TourCorner({ tour }: { tour: AgentSurfaceTour }) {
  const Corner = tourCorner.maybe();
  return Corner ? <Corner tour={tour} /> : null;
}
