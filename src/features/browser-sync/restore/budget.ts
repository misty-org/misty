/** Agent-restore limits. The server enforces the step and daily caps too. */
export const RESTORE_LIMITS = {
  stepsPerTab: 8,
  tabsPerSwitch: 3,
  tabsPerDay: 30,
} as const;

const KEY = "misty.pageRestore.agentRuns";

function readRuns(now: number): number[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(raw)
      ? raw.filter((t): t is number => typeof t === "number" && now - t < 86_400_000)
      : [];
  } catch {
    return [];
  }
}

/** Reserves one agent-restore tab against the per-switch and daily caps. */
export function reserveAgentRestore(usedThisSwitch: number, now = Date.now()): boolean {
  if (usedThisSwitch >= RESTORE_LIMITS.tabsPerSwitch) return false;
  const runs = readRuns(now);
  if (runs.length >= RESTORE_LIMITS.tabsPerDay) return false;
  try {
    localStorage.setItem(KEY, JSON.stringify([...runs, now]));
  } catch {
    // Storage may be unavailable; the server's daily cap still applies.
  }
  return true;
}
