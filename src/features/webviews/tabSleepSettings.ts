/** Minutes a tab stays hidden before its page sleeps; 0 never sleeps. */
let sleepAfterMinutes = 30;

export function configureBrowserTabSleep(minutes: number): void {
  sleepAfterMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
}

export function tabSleepMinutes(): number {
  return sleepAfterMinutes;
}
