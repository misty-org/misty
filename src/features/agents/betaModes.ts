import { hasTauriInternals } from "@/shared/platform/tauri";
// The first visible-control beta targets foreground macOS.
export const visibleAutopilotAvailable = () =>
  hasTauriInternals() && /Mac/.test(navigator.platform);
export const betaExecutionMode = (mode: "user" | "agent" | "team" = "user") =>
  visibleAutopilotAvailable() ? ("agent" as const) : mode;
