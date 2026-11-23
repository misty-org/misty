import { hasTauriInternals } from "@/shared/platform/tauri";
export const visibleAutopilotAvailable = () =>
  hasTauriInternals() && /Mac|Win/.test(navigator.platform);
