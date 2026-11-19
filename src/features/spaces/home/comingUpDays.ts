/** How far ahead a task's due date counts as coming up, unless Settings › Space says otherwise. */
const taskHorizonDays = 14;
export const comingUpDayChoices = ["7", "14", "30"] as const;

/** The days ahead a task counts as coming up, as set in Settings › Space. */
export function comingUpDays(document?: Record<string, unknown> | null): number {
  const space = document?.space as Record<string, unknown> | undefined;
  const days = Number(space?.coming_up_days);
  return (comingUpDayChoices as readonly string[]).includes(String(days)) ? days : taskHorizonDays;
}
