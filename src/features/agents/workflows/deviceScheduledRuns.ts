import { hasTauriInternals } from "@/shared/platform/tauri";
import { agentsDeviceSnapshot } from "../personal/useAgentsStore";
import { runLocalSchedules } from "./localScheduler";

/** This computer's id for its agents, or null outside the desktop app. */
export async function thisComputerDeviceId(): Promise<string | null> {
  if (!hasTauriInternals()) return null;
  const local = await agentsDeviceSnapshot().catch(() => null);
  return local?.device && local.device.status !== "revoked" ? local.device.id : null;
}

let running: Promise<void> | null = null;

/** Starts every scheduled run due on this computer. Safe to call often. */
export function startWaitingScheduledRuns(accountId: string): Promise<void> {
  running ??= runLocalSchedules(accountId).finally(() => {
    running = null;
  });
  return running;
}
