import { hasTauriInternals } from "@/shared/platform/tauri";
// Visible control runs in the Misty app on macOS and Windows.
export const visibleAutopilotAvailable = () =>
  hasTauriInternals() &&
  /Mac|Win/.test(navigator.platform) &&
  !new URLSearchParams(window.location.search).has("agent_worker");
