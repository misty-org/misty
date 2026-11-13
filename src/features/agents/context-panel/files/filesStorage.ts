/** The file tree's own small values in local storage (expanded folders, open tabs). */
export function readStored<T>(key: string, parse: (value: unknown) => T | null): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? parse(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable; the tree still works for this visit.
  }
}
