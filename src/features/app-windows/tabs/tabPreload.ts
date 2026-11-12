import { isFromElsewhere } from "./tabsFromElsewhere";

/**
 * Gets tabs from another computer loaded before they're opened, so going to them finds the page
 * ready. Only a few at a time, so many arriving at once don't load everything, and after a wait.
 *
 * Until it's opened, a preloaded page is nobody's browsing: it adds no history and sends nothing,
 * or a redirect to a sign-in page would move the tab on the computer it came from.
 */
const SIGN_IN_WAIT_MS = 8_000;
const MOST_WAITING = 5;

const preloaded = new Set<string>();
let arrivals: { id: string; view: unknown }[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

/** Whether this view's page may load in the background. */
export function mayPreload(viewId: string): boolean {
  return !isFromElsewhere(viewId) || preloaded.has(viewId);
}

/** Loaded in the background and not opened yet. */
export function isUnseenPreload(viewId: string): boolean {
  return preloaded.has(viewId);
}

/** Tabs arrived. `ready` runs once some of them may load, the newest first. */
export function preloadArrived<View>(views: { id: string; view: View }[], ready: () => void) {
  if (!views.length) return;
  arrivals.push(...views);
  clearTimeout(timer);
  timer = setTimeout(() => {
    const room = Math.max(0, MOST_WAITING - preloaded.size);
    const chosen = room ? arrivals.slice(-room) : [];
    arrivals = [];
    for (const { id } of chosen) preloaded.add(id);
    if (chosen.length) ready();
  }, SIGN_IN_WAIT_MS);
}

/** The person opened it: from here it's a normal tab. */
export function preloadSeen(viewId: string) {
  preloaded.delete(viewId);
  arrivals = arrivals.filter(({ id }) => id !== viewId);
}

/** Forgets views no longer in this window's tabs. */
export function keepPreloads(present: Set<string>) {
  for (const id of preloaded) if (!present.has(id)) preloaded.delete(id);
  arrivals = arrivals.filter(({ id }) => present.has(id));
}
