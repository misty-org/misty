import { isFromElsewhere } from "./tabsFromElsewhere";

/**
 * Gets tabs from another computer loaded before they're opened, so going to them finds the page
 * ready. Only a few at a time, so a big sync doesn't load everything, and after a wait, because a
 * tab travels ahead of its site's cookies: loaded at once, it would load signed out.
 *
 * Until it's opened, a preloaded page is nobody's browsing: it adds no history and sends nothing,
 * or a redirect to a sign-in page would move the tab on the computer it came from.
 */
const SIGN_IN_WAIT_MS = 8_000;
const MOST_WAITING = 5;
/** Sign-ins that arrive this soon after loading are the ones the page was missing. */
const SIGN_IN_WINDOW_MS = 60_000;

interface Preloaded<View> {
  view: View;
  at: number;
  reloaded: boolean;
}

const preloaded = new Map<string, Preloaded<unknown>>();
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
export function preloadArrived<View>(
  views: { id: string; view: View }[],
  ready: () => void,
  now: () => number = Date.now,
) {
  if (!views.length) return;
  arrivals.push(...views);
  clearTimeout(timer);
  timer = setTimeout(() => {
    const room = Math.max(0, MOST_WAITING - preloaded.size);
    const chosen = room ? arrivals.slice(-room) : [];
    arrivals = [];
    for (const { id, view } of chosen) preloaded.set(id, { view, at: now(), reloaded: false });
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
  for (const id of preloaded.keys()) if (!present.has(id)) preloaded.delete(id);
  arrivals = arrivals.filter(({ id }) => present.has(id));
}

/** A site's sign-in arrived: the pages to load again. Each only once, and only soon after loading. */
export function preloadsToReload<View>(now: number = Date.now()): View[] {
  const due: View[] = [];
  for (const entry of preloaded.values()) {
    if (entry.reloaded || now - entry.at > SIGN_IN_WINDOW_MS) continue;
    entry.reloaded = true;
    due.push(entry.view as View);
  }
  return due;
}
