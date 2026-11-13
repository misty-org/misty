// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong): upgrade-announcement.ts.
// See NOTICE.

/**
 * What changed in an update, shown once after Misty restarts on it. The notes come with the
 * update itself (the release's own notes, read when the person installs it in Settings), are kept
 * in this window's storage until the new version starts, and are shown once. A version that
 * came without notes, a first install, a downgrade or a version that can't be compared shows
 * nothing.
 */

const PENDING_KEY = "misty.updater.pendingReleaseNotes:v1";
const LAST_SEEN_KEY = "misty.updater.lastSeenVersion:v1";

export interface ReleaseNotes {
  version: string;
  date: string | null;
  notes: string;
}

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, "");
}

/** `a` newer than `b` is positive, older negative, the same (or not comparable) 0. Parts are
 *  compared as numbers, missing parts count as 0, and anything else (a pre-release suffix)
 *  counts as not comparable: better to skip the notes once than call a downgrade new. */
function compareVersions(a: string, b: string): number {
  const parts = (version: string) =>
    normalizeVersion(version)
      .split(".")
      .map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN));
  const left = parts(a);
  const right = parts(b);
  if (left.some(Number.isNaN) || right.some(Number.isNaN)) return 0;
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage off: the notes just aren't shown.
  }
}

/** Keeps an update's notes for after the restart; called just before it installs. */
export function rememberReleaseNotes(update: {
  version: string;
  date?: string | null;
  body?: string | null;
}) {
  const notes = update.body?.trim();
  if (!notes) {
    write(PENDING_KEY, null);
    return;
  }
  const pending: ReleaseNotes = {
    version: normalizeVersion(update.version),
    date: update.date ?? null,
    notes,
  };
  write(PENDING_KEY, JSON.stringify(pending));
}

function readPending(): ReleaseNotes | null {
  const raw = read(PENDING_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ReleaseNotes>;
    if (typeof value.version !== "string" || typeof value.notes !== "string") return null;
    return {
      version: value.version,
      date: typeof value.date === "string" ? value.date : null,
      notes: value.notes,
    };
  } catch {
    return null;
  }
}

/**
 * The notes to show now that `current` is running, once: the baseline is written first, so a
 * failure never shows them again on the next start. Null when there is nothing new to show.
 */
export function takeReleaseNotes(current: string): ReleaseNotes | null {
  const version = normalizeVersion(current);
  if (!version) return null;
  const lastSeen = read(LAST_SEEN_KEY);
  write(LAST_SEEN_KEY, version);
  const pending = readPending();
  if (!pending) return null;
  // Notes for a version still to come (an install that failed) wait for it.
  const ahead = compareVersions(pending.version, version);
  if (ahead > 0) return null;
  write(PENDING_KEY, null);
  if (ahead < 0 || pending.version !== version) return null;
  if (lastSeen && compareVersions(version, lastSeen) <= 0) return null;
  return pending;
}
