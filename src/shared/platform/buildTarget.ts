const configuredTarget = import.meta.env.VITE_MISTY_TARGET?.trim().toLowerCase();

export const mistyBuildTarget: MistyBuildTarget =
  configuredTarget === "web" || import.meta.env.MODE === "web"
    ? "web"
    : configuredTarget === "android" || import.meta.env.MODE === "android"
      ? "android"
      : configuredTarget === "mobile" || import.meta.env.MODE === "mobile"
        ? "mobile"
        : "desktop";

export const isNativeMobileBuild = mistyBuildTarget === "mobile" || mistyBuildTarget === "android";
export const isIosBuild = mistyBuildTarget === "mobile";
export const isAndroidBuild = mistyBuildTarget === "android";
export const isWebBuild = mistyBuildTarget === "web";

export type MistyBuildTarget = "desktop" | "mobile" | "android" | "web";
