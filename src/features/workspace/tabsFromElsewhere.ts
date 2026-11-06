import { currentProfile } from "./profileWindow";

/**
 * Pages of tabs that arrived from another computer. They stay asleep until clicked, so a profile
 * with hundreds of tabs elsewhere doesn't load them all here, now or at the next launch.
 */
const storageKey = () => `misty.tabs.from-elsewhere.${currentProfile().id}`;

function read(): Set<string> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey()) ?? "[]");
    return new Set(Array.isArray(stored) ? stored.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function write(views: Set<string>) {
  try {
    localStorage.setItem(storageKey(), JSON.stringify([...views]));
  } catch {
    // Only costs a background load of a tab that could have slept.
  }
}

export function isFromElsewhere(viewId: string): boolean {
  return read().has(viewId);
}

export function markFromElsewhere(viewIds: string[]) {
  if (!viewIds.length) return;
  const views = read();
  for (const id of viewIds) views.add(id);
  write(views);
}

/** Forgets views no longer in this window's tabs. */
export function keepFromElsewhere(present: Iterable<string>) {
  const views = read();
  const kept = new Set([...present].filter((id) => views.has(id)));
  if (kept.size !== views.size) write(kept);
}
