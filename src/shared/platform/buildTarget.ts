import type { MistyBuildTarget } from "./model/types/buildTarget";
export type { MistyBuildTarget } from "./model/types/buildTarget";
const configuredTarget = import.meta.env.VITE_MISTY_TARGET?.trim().toLowerCase();
export const mistyBuildTarget: MistyBuildTarget =
  configuredTarget === "web" || import.meta.env.MODE === "web" ? "web" : "desktop";
export const isWebBuild = mistyBuildTarget === "web";
