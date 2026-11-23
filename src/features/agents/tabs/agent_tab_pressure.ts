import { invoke } from "@tauri-apps/api/core";

const LIVE_UNDER_PRESSURE = { normal: Infinity, warning: 2, critical: 1 } as const;
type PressureLevel = keyof typeof LIVE_UNDER_PRESSURE;
let pressure: { level: PressureLevel; at: number } = { level: "normal", at: 0 };

export async function pressureLevel(): Promise<PressureLevel> {
  if (Date.now() - pressure.at < 5_000) return pressure.level;
  const level = await invoke<string>("system_memory_pressure").catch(() => "normal");
  pressure = {
    level: level === "critical" || level === "warning" ? level : "normal",
    at: Date.now(),
  };
  return pressure.level;
}

export const livePagesAllowed = async () => LIVE_UNDER_PRESSURE[await pressureLevel()];

export function resetMemoryPressure() {
  pressure = { level: "normal", at: 0 };
}
