import type { TaskCompletion } from "./task-completion.js";

// Long requests need persistence (docs/plans/odysseys-campaign.md): the first Odysseys
// batch finished "partial" after a minute or two with most of each run's turns unused,
// usually right after one page or tool failed. A partial or blocked finish is refused
// (up to three times, with work between) while ten or more turns remain, unless every unfinished
// part needs the person.

/** Unfinished parts only the person can unblock: an account, a payment, a human check. */
const needsPerson = /\b(sign[ -]?in|log[ -]?in|password|account|captcha|verification|verify|2fa|one-time code|payment|pay|purchase|checkout|paywall|subscri)/i;

/**
 * Whether another early give-up may be sent back. Three were allowed whatever the time, and a
 * 20-school run gave up for good 8 minutes into its own 45-minute estimate (October 19): while a
 * run is under 80% of its estimate it may be sent back up to eight times.
 */
export function mayRefuseGiveUp(refusals: number, elapsedMs: number, estimateMinutes: number | undefined): boolean {
  if (refusals < 3) return true;
  return refusals < 8 && estimateMinutes !== undefined && elapsedMs < estimateMinutes * 60_000 * 0.8;
}

/** The refusal message, or undefined when the finish should stand. */
export function earlyGiveUp(report: TaskCompletion, turn: number, limit: number): string | undefined {
  if (report.outcome === "completed" || !report.remaining.length) return undefined;
  // Late give-ups count too: a run quit at turn 54 of 90 with fifteen of twenty pages unopened.
  if (turn >= limit - 10) return undefined;
  const open = report.remaining.filter((item) => !needsPerson.test(`${item.requirement} ${item.reason}`));
  if (!open.length) return undefined;
  const list = open.map((item) => `- ${item.requirement}`).join("\n");
  return `Not finished yet, and this run still has time. These parts remain:\n${list}\n` +
    "Work each one another way before reporting: find the right page with web_search (add site: and the domain), open it in your own tab (screen_open, then browser_navigate), read it with browser_snapshot, and use the site's own search, filters and links. A page or tool that failed is a reason to try another route, not to stop. " +
    "Report partial only for parts that need the person (a sign-in, a payment, a CAPTCHA) or that the sites truly do not have, and say what you tried.";
}
