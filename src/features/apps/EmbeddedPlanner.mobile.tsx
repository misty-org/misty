import { lazy } from "react";
/** Temporary mobile renderer until its SDK migration passes platform checks. */
export const EmbeddedPlanner = lazy(() =>
  import("@/features/spaces/planner/SpacePlanner").then((module) => ({
    default: module.SpacePlanner,
  })),
);
