/** The Space home's view, maker filter and order, remembered on this device only. */
const key = (name: string) => `misty.spaceHome.${name}`;

export function readHomePreference<T extends string>(name: string, fallback: T): T {
  try {
    return (localStorage.getItem(key(name)) as T | null) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeHomePreference(name: string, value: string) {
  try {
    localStorage.setItem(key(name), value);
  } catch {
    // Storage can be unavailable; the choice still holds for this visit.
  }
}
