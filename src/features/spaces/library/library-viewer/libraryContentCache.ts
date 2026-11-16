import { accountScopeResetEvent } from "@/features/account";

/**
 * What the Library has loaded this session, as object URLs, so opening a file again (or stepping
 * to one fetched ahead) shows it at once instead of loading it again. The grid's thumbnails and
 * the viewer share it, so an image whose thumbnail is on screen opens without a second download.
 * A file's version is part of its key, so an edit loads the new one. Past `most`, the least
 * recently used are let go, except those something on screen still holds.
 */

const most = 48;

interface Entry {
  url?: string;
  /** The bytes' own type, which can differ from the item's (a PDF's preview is an image). */
  type?: string;
  pending?: Promise<string>;
  /** How many things on screen show this URL; a held one is never let go. */
  holds: number;
}

const entries = new Map<string, Entry>();

/** Marks a key as just used, so it's the last to be let go. */
function touch(key: string, entry: Entry) {
  entries.delete(key);
  entries.set(key, entry);
}

function trim() {
  for (const [key, entry] of entries) {
    if (entries.size <= most) break;
    // Only a finished, unheld one is let go; one still loading is wanted by whoever is waiting
    // on it, and a held one is on screen.
    if (!entry.url || entry.holds > 0) continue;
    URL.revokeObjectURL(entry.url);
    entries.delete(key);
  }
}

/** The object URL already loaded for this key, if any. */
export function cachedContent(key: string): string | undefined {
  const entry = entries.get(key);
  if (entry?.url) touch(key, entry);
  return entry?.url;
}

/** Loads the content once for this key and keeps it; callers asking at the same time share it. */
export function loadContent(key: string, fetch: () => Promise<Blob>): Promise<string> {
  const known = entries.get(key);
  if (known?.url) {
    touch(key, known);
    return Promise.resolve(known.url);
  }
  if (known?.pending) return known.pending;
  const entry: Entry = { holds: 0 };
  entry.pending = fetch()
    .then((blob) => {
      entry.url = URL.createObjectURL(blob);
      entry.type = blob.type;
      entry.pending = undefined;
      trim();
      return entry.url;
    })
    .catch((error: unknown) => {
      // A failed load isn't kept: opening it again tries again.
      entries.delete(key);
      throw error;
    });
  touch(key, entry);
  return entry.pending;
}

/** The type of the bytes loaded for this key, once they are. */
export function cachedContentType(key: string): string | undefined {
  return entries.get(key)?.type;
}

/** Loads it ahead of being asked for, as the image after the one on screen. Failures are quiet. */
export function prefetchContent(key: string, fetch: () => Promise<Blob>): Promise<string | null> {
  return loadContent(key, fetch).catch(() => null);
}

/**
 * Keeps this key's URL from being let go while something shows it; the returned function lets go
 * again. Holding a key not loaded yet does nothing.
 */
export function holdContent(key: string): () => void {
  const entry = entries.get(key);
  if (!entry?.url) return () => {};
  entry.holds += 1;
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    entry.holds -= 1;
    trim();
  };
}

/**
 * The key for what the Library shows of an item: its preview, at this version. The thumbnail
 * and the viewer ask for the same bytes under it.
 */
export function libraryViewKey(
  spaceId: string,
  itemId: string,
  version: number,
  renditionState = "",
): string {
  return [spaceId, itemId, version, "view", renditionState].join(":");
}

/** Lets go of everything, as when the account changes. */
export function clearLibraryContent() {
  for (const entry of entries.values()) if (entry.url) URL.revokeObjectURL(entry.url);
  entries.clear();
}

// Another account's files never show from here.
if (typeof window !== "undefined")
  window.addEventListener(accountScopeResetEvent, clearLibraryContent);
