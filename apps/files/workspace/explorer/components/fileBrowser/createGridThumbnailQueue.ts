import type { FileEntry } from "@/native/contracts";
import type { GridThumbnailJob } from "../../model/interfaces/components/FileBrowser";
import type { GridThumbnailSubscriber } from "../../model/types/components/FileBrowser";
import { GRID_THUMBNAIL_MAX_DIMENSION, MAX_CONCURRENT_GRID_THUMBNAILS } from "./fileTableConfig";
import { gridThumbnailSupported } from "./gridThumbnailSupported";
const BACKGROUND_START_DELAY_MS = 250;
/** Keep the existing visible-before-background queue, with an owning thumbnail backend. */
export function createGridThumbnailQueue(
  loadThumbnail: (entry: FileEntry, maxDimension: number) => Promise<string>,
  releaseUrl: (url: string) => void = () => undefined,
) {
  let closed = false,
    currentGeneration = 0;
  // Module-level so results survive remounts and every grid shares one queue —
  // scrolling a large folder would otherwise re-generate the same thumbnails.
  const gridThumbnailUrlCache = new Map<string, string>();
  const failedGridThumbnails = new Set<string>();
  const gridThumbnailQueue: GridThumbnailJob[] = [];
  const gridThumbnailJobs = new Map<string, GridThumbnailJob>();
  let activeGridThumbnailJobs = 0;
  let backgroundGridThumbnailTimer: number | null = null;

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
  function prewarmGridThumbnails(entries: FileEntry[]): void {
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
  function requestGridThumbnail(
    entry: FileEntry,
    maxDimension: number,
    subscriber: GridThumbnailSubscriber,
  ): () => void {
    if (closed) return () => undefined;
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
    if (closed) return null;
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
    while (!closed && activeGridThumbnailJobs < MAX_CONCURRENT_GRID_THUMBNAILS) {
      const job = gridThumbnailQueue.shift();
      if (!job) return;
      if (gridThumbnailUrlCache.has(job.key) || failedGridThumbnails.has(job.key)) {
        gridThumbnailJobs.delete(job.key);
        continue;
      }
      const generation = currentGeneration;
      job.processing = true;
      activeGridThumbnailJobs += 1;
      void loadThumbnail(job.entry, job.maxDimension)
        .then((url) => {
          if (closed || generation !== currentGeneration) {
            releaseUrl(url);
            return;
          }
          gridThumbnailUrlCache.set(job.key, url);
          for (const subscriber of job.subscribers) subscriber(url);
        })
        .catch(() => {
          if (closed || generation !== currentGeneration) return;
          failedGridThumbnails.add(job.key);
          for (const subscriber of job.subscribers) subscriber(null);
        })
        .finally(() => {
          job.processing = false;
          activeGridThumbnailJobs -= 1;
          if (gridThumbnailJobs.get(job.key) === job) gridThumbnailJobs.delete(job.key);
          processNextGridThumbnail();
        });
    }
  }

  function removeQueuedGridThumbnailJob(job: GridThumbnailJob): void {
    const index = gridThumbnailQueue.indexOf(job);
    if (index >= 0) gridThumbnailQueue.splice(index, 1);
  }

  function clear() {
    currentGeneration++;
    if (backgroundGridThumbnailTimer !== null) window.clearTimeout(backgroundGridThumbnailTimer);
    backgroundGridThumbnailTimer = null;
    for (const url of gridThumbnailUrlCache.values()) releaseUrl(url);
    gridThumbnailUrlCache.clear();
    failedGridThumbnails.clear();
    gridThumbnailQueue.length = 0;
    gridThumbnailJobs.clear();
  }
  return {
    prewarmGridThumbnails,
    requestGridThumbnail,
    clear,
    close() {
      closed = true;
      clear();
    },
  };
}
