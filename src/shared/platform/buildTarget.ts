const configuredTarget = import.meta.env.VITE_MISTY_TARGET?.trim().toLowerCase();

export const mistyBuildTarget: MistyBuildTarget =
  configuredTarget === "android" || import.meta.env.MODE === "android"
    ? "android"
    : configuredTarget === "mobile" || import.meta.env.MODE === "mobile"
      ? "mobile"
      : "desktop";

export const isNativeMobileBuild = mistyBuildTarget === "mobile" || mistyBuildTarget === "android";
export const isAndroidBuild = mistyBuildTarget === "android";

export type MistyBuildTarget = "desktop" | "mobile" | "android";
