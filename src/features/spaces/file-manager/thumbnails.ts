// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.

const MOST_AT_ONCE = 8;
const BACKGROUND_AFTER_MS = 250;

export type ThumbnailState = "ready" | "failed" | "waiting";

interface Job {
  url: string;
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

function pump() {
  while (running < MOST_AT_ONCE) {
    const shown = queue.find((job) => !job.background);
    const next = shown ?? (Date.now() >= backgroundFrom ? queue[0] : undefined);
    if (!next) return;
    take(next);
    start(next);
  }
}

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
