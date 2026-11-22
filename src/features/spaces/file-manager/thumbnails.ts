// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
/**
 * Files' thumbnails, a few at a time, as Kura draws them. A picture on screen waits its turn in one
 * queue that every grid shares, ahead of the folder's other pictures, which are fetched behind it
 * once the folder has been open a moment. Native code makes each in milliseconds with the system's
 * own image reader, so several go at once; the cap only keeps a folder of thousands from flooding
 * the protocol ahead of the file the person opens. What has been fetched is remembered for the
 * rest of the session, so a grid drawn again shows its pictures at once; the protocol keeps them
 * on disk too (`src-tauri/features/files/protocol.rs`).
 */

const MOST_AT_ONCE = 8;
/** How long a folder is open before its off-screen pictures are fetched. */
const BACKGROUND_AFTER_MS = 250;

export type ThumbnailState = "ready" | "failed" | "waiting";

interface Job {
  url: string;
  /** Fetched ahead for a folder, not asked for by a picture on screen. */
  background: boolean;
  started: boolean;
  waiters: Set<(state: ThumbnailState) => void>;
}

const done = new Map<string, Exclude<ThumbnailState, "waiting">>();
const jobs = new Map<string, Job>();
const queue: Job[] = [];
let running = 0;
let backgroundFrom = 0;
let backgroundTimer: ReturnType<typeof setTimeout> | undefined;

/** Whether `url` has been fetched already, and how that went. */
export const thumbnailState = (url: string): ThumbnailState => done.get(url) ?? "waiting";

function take(job: Job) {
  const index = queue.indexOf(job);
  if (index >= 0) queue.splice(index, 1);
}

function start(job: Job) {
  running += 1;
  job.started = true;
  const picture = new Image();
  const finish = (state: Exclude<ThumbnailState, "waiting">) => {
    running -= 1;
    jobs.delete(job.url);
    done.set(job.url, state);
    for (const waiter of job.waiters) waiter(state);
    pump();
  };
  picture.onload = () => finish("ready");
  picture.onerror = () => finish("failed");
  picture.src = job.url;
}

/** Starts what may start: pictures on screen first, the folder's others once their wait is over. */
function pump() {
  while (running < MOST_AT_ONCE) {
    const shown = queue.find((job) => !job.background);
    const next = shown ?? (Date.now() >= backgroundFrom ? queue[0] : undefined);
    if (!next) return;
    take(next);
    start(next);
  }
}

/**
 * Asks for a picture on screen. `onDone` is told once it is fetched (or failed); the answer is to
 * call when the picture leaves the screen before its turn, which drops it from the queue.
 */
export function wantThumbnail(url: string, onDone: (state: ThumbnailState) => void): () => void {
  const known = done.get(url);
  if (known) {
    onDone(known);
    return () => undefined;
  }
  let job = jobs.get(url);
  if (!job) {
    job = { url, background: false, started: false, waiters: new Set() };
    jobs.set(url, job);
  }
  job.background = false;
  job.waiters.add(onDone);
  if (!job.started) {
    // The newest picture on screen goes first, so scrolling always beats what scrolled past.
    take(job);
    queue.unshift(job);
  }
  pump();
  const asked = job;
  return () => {
    asked.waiters.delete(onDone);
    if (asked.waiters.size === 0 && !asked.started) {
      take(asked);
      jobs.delete(asked.url);
    }
  };
}

/**
 * Fetches a folder's pictures behind the ones on screen, once it has been open a moment. A new
 * folder's list replaces the last one's: what it hadn't started is dropped.
 */
export function prewarmThumbnails(urls: readonly string[]) {
  for (const job of [...queue]) {
    if (job.background && job.waiters.size === 0) {
      take(job);
      jobs.delete(job.url);
    }
  }
  for (const url of urls) {
    if (done.has(url) || jobs.has(url)) continue;
    const job: Job = { url, background: true, started: false, waiters: new Set() };
    jobs.set(url, job);
    queue.push(job);
  }
  backgroundFrom = Date.now() + BACKGROUND_AFTER_MS;
  if (backgroundTimer !== undefined) clearTimeout(backgroundTimer);
  backgroundTimer = setTimeout(() => {
    backgroundTimer = undefined;
    pump();
  }, BACKGROUND_AFTER_MS);
}
