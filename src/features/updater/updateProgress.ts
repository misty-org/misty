import type { DownloadEvent } from "@tauri-apps/plugin-updater";

export interface UpdateProgress {
  downloadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
}

export const EMPTY_UPDATE_PROGRESS: UpdateProgress = {
  downloadedBytes: 0,
  totalBytes: null,
  percent: null,
};

export function applyUpdateProgress(current: UpdateProgress, event: DownloadEvent): UpdateProgress {
  if (event.event === "Started") {
    const totalBytes = event.data.contentLength;
    return {
      downloadedBytes: 0,
      totalBytes: totalBytes && totalBytes > 0 ? totalBytes : null,
      percent: totalBytes && totalBytes > 0 ? 0 : null,
    };
  }
  if (event.event === "Progress") {
    const downloadedBytes = current.downloadedBytes + Math.max(0, event.data.chunkLength);
    return {
      ...current,
      downloadedBytes,
      percent:
        current.totalBytes === null
          ? null
          : Math.min(100, Math.round((downloadedBytes / current.totalBytes) * 100)),
    };
  }
  return {
    ...current,
    percent: current.totalBytes === null ? null : 100,
  };
}

export function readableUpdateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/not configured|pubkey|endpoint/i.test(message)) {
    return "Updates are not configured in this development build.";
  }
  if (/network|fetch|connect|timed? ?out/i.test(message)) {
    return "Could not reach the update service. Check your connection and try again.";
  }
  return "Misty could not check for updates. Please try again.";
}
