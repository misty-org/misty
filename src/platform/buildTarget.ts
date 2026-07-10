export type MistyBuildTarget = "desktop" | "mobile" | "android";

const configuredTarget = import.meta.env.VITE_MISTY_TARGET?.trim().toLowerCase();

export const mistyBuildTarget: MistyBuildTarget = configuredTarget === "android"
  ? "android"
  : configuredTarget === "mobile" || import.meta.env.MODE === "mobile"
    ? "mobile"
    : "desktop";

// Android shares mobile-safe storage, auth, and capability rules with iOS.
export const isNativeMobileBuild = mistyBuildTarget === "mobile" || mistyBuildTarget === "android";
export const isAndroidBuild = mistyBuildTarget === "android";

// iOS remains phone-only. Android bundles both layouts and chooses at runtime.
export const isPhoneOnlyLayoutBuild = mistyBuildTarget === "mobile";
