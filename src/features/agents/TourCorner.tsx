import type { ComponentType } from "react";
import { createPort } from "@/shared/lib/seams";

/** The tours an agents surface has a corner "i" for (onboarding's tour ids). */
export type AgentSurfaceTour = "agent-settings" | "add-sources";

/**
 * The corner "i" that replays a surface's tour. Tours live in onboarding, which depends on this
 * feature, so the app hands the button in at startup (app/featureSeams.ts) instead of agents
 * importing onboarding back.
 */
export const tourCorner = createPort<ComponentType<{ tour: AgentSurfaceTour }>>("Tour corner");

/** The surface's tour button, or nothing before onboarding has provided it. */
export function TourCorner({ tour }: { tour: AgentSurfaceTour }) {
  const Corner = tourCorner.maybe();
  return Corner ? <Corner tour={tour} /> : null;
}
