import { invoke } from "@tauri-apps/api/core";

/** Live agent pages the system can spare now, by memory pressure. */
const LIVE_UNDER_PRESSURE = { normal: Infinity, warning: 2, critical: 1 } as const;
type PressureLevel = keyof typeof LIVE_UNDER_PRESSURE;
let pressure: { level: PressureLevel; at: number } = { level: "normal", at: 0 };

/** The system's memory pressure, asked at most every five seconds. */
export async function pressureLevel(): Promise<PressureLevel> {
  if (Date.now() - pressure.at < 5_000) return pressure.level;
  const level = await invoke<string>("system_memory_pressure").catch(() => "normal");
  pressure = {
    level: level === "critical" || level === "warning" ? level : "normal",
    at: Date.now(),
  };
  return pressure.level;
}

/** How many agent pages may be live at once now. */
export const livePagesAllowed = async () => LIVE_UNDER_PRESSURE[await pressureLevel()];

/** For tests. */
export function resetMemoryPressure() {
  pressure = { level: "normal", at: 0 };
}
