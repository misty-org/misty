import { explorerGenerateImageThumbnail } from "@/features/files/native";
import type { FileEntry } from "@/native/contracts";
import { safeTauriAssetUrl } from "@/shared/platform/tauri";
import type { GridThumbnailJob } from "../../model/interfaces/components/FileBrowser";
import type { GridThumbnailSubscriber } from "../../model/types/components/FileBrowser";
import { GRID_THUMBNAIL_MAX_DIMENSION, MAX_CONCURRENT_GRID_THUMBNAILS } from "./fileTableConfig";

const BACKGROUND_START_DELAY_MS = 250;

const gridThumbnailImageExtensions = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "webp",
  "tga",
  "hdr",
  "pic",
  "pbm",
  "pgm",
  "pnm",
  "ppm",
  "psd",
]);

// Module-level so results survive remounts and every grid shares one queue —
// scrolling a large folder would otherwise re-generate the same thumbnails.
const gridThumbnailUrlCache = new Map<string, string>();
const failedGridThumbnails = new Set<string>();
const gridThumbnailQueue: GridThumbnailJob[] = [];
const gridThumbnailJobs = new Map<string, GridThumbnailJob>();
let activeGridThumbnailJobs = 0;
let backgroundGridThumbnailTimer: number | null = null;

export function gridThumbnailSupported(entry: FileEntry): boolean {
  if (entry.kind === "folder" || entry.kind === "symlink" || entry.isDeleted) return false;
  if (entry.location.kind === "remote_provider") return false;
  const extension = entry.extension.toLowerCase().replace(/^\./, "");
  return gridThumbnailImageExtensions.has(extension);
}

/** Keyed on everything that would change the pixels, so edits invalidate it. */
function gridThumbnailCacheKey(entry: FileEntry, maxDimension: number): string {
  return [
    entry.path,
    entry.sizeBytes ?? "",
    entry.modifiedMs ?? "",
    entry.remoteModified ?? "",
    maxDimension,
  ].join("\0");
}

/** Queues thumbnails for entries that are not on screen yet, at low priority. */
export function prewarmGridThumbnails(entries: FileEntry[]): void {
  for (const entry of entries) {
    if (gridThumbnailSupported(entry))
      enqueueGridThumbnail(entry, GRID_THUMBNAIL_MAX_DIMENSION, true);
  }
}

/**
 * Subscribes to a thumbnail, returning an unsubscribe.
 *
 * A visible request promotes any matching background job to the front of the
 * queue, so scrolling always beats prewarming.
 */
export function requestGridThumbnail(
  entry: FileEntry,
  maxDimension: number,
  subscriber: GridThumbnailSubscriber,
): () => void {
  const key = gridThumbnailCacheKey(entry, maxDimension);
  const cached = gridThumbnailUrlCache.get(key);
  if (cached) {
    subscriber(cached);
    return () => undefined;
  }
  const job = enqueueGridThumbnail(entry, maxDimension, false);
  if (!job) return () => undefined;
  job.subscribers.add(subscriber);
  job.background = false;
  promoteGridThumbnailJob(job);

  return () => {
    job.subscribers.delete(subscriber);
    if (job.subscribers.size === 0 && !job.processing && !job.background) {
      removeQueuedGridThumbnailJob(job);
      gridThumbnailJobs.delete(job.key);
    }
  };
}

function enqueueGridThumbnail(
  entry: FileEntry,
  maxDimension: number,
  background: boolean,
): GridThumbnailJob | null {
  const key = gridThumbnailCacheKey(entry, maxDimension);
  if (gridThumbnailUrlCache.has(key) || failedGridThumbnails.has(key)) return null;

  const existing = gridThumbnailJobs.get(key);
  if (existing) {
    if (!background) {
      existing.background = false;
      promoteGridThumbnailJob(existing);
    }
    return existing;
  }

  const job: GridThumbnailJob = {
    key,
    entry,
    maxDimension,
    subscribers: new Set(),
    processing: false,
    background,
  };
  gridThumbnailJobs.set(key, job);
  gridThumbnailQueue.push(job);
  if (background) scheduleBackgroundGridThumbnailProcessing();
  else processNextGridThumbnail();
  return job;
}

function promoteGridThumbnailJob(job: GridThumbnailJob): void {
  if (job.processing) return;
  removeQueuedGridThumbnailJob(job);
  gridThumbnailQueue.unshift(job);
  processNextGridThumbnail();
}

function scheduleBackgroundGridThumbnailProcessing(): void {
  if (backgroundGridThumbnailTimer != null) return;
  backgroundGridThumbnailTimer = window.setTimeout(() => {
    backgroundGridThumbnailTimer = null;
    processNextGridThumbnail();
  }, BACKGROUND_START_DELAY_MS);
}

function processNextGridThumbnail(): void {
  while (activeGridThumbnailJobs < MAX_CONCURRENT_GRID_THUMBNAILS) {
    const job = gridThumbnailQueue.shift();
    if (!job) return;
    if (gridThumbnailUrlCache.has(job.key) || failedGridThumbnails.has(job.key)) {
      gridThumbnailJobs.delete(job.key);
      continue;
    }
    job.processing = true;
    activeGridThumbnailJobs += 1;
    void explorerGenerateImageThumbnail(job.entry.path, job.maxDimension, {
      modifiedMs: job.entry.modifiedMs,
      remoteModified: job.entry.remoteModified,
      sizeBytes: job.entry.sizeBytes,
    })
      .then((payload) => {
        const url = safeTauriAssetUrl(payload.path);
        gridThumbnailUrlCache.set(job.key, url);
        for (const subscriber of job.subscribers) subscriber(url);
      })
      .catch(() => {
        failedGridThumbnails.add(job.key);
        for (const subscriber of job.subscribers) subscriber(null);
      })
      .finally(() => {
        job.processing = false;
        activeGridThumbnailJobs -= 1;
        gridThumbnailJobs.delete(job.key);
        processNextGridThumbnail();
      });
  }
}

function removeQueuedGridThumbnailJob(job: GridThumbnailJob): void {
  const index = gridThumbnailQueue.indexOf(job);
  if (index >= 0) gridThumbnailQueue.splice(index, 1);
}
