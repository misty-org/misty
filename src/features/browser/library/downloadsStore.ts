import { create } from "zustand";
import { browserLibrary, type BrowserDownloadEntry } from "./native";

const progressIntervalMs = 500;
/** How long a finished download keeps the toolbar button visible. */
export const recentDownloadMs = 10 * 60_000;

interface BrowserDownloadsStore {
  entries: BrowserDownloadEntry[];
  loaded: boolean;
  error: string | null;
  /** Bumped when a download finishes, so the toolbar button can draw attention. */
  lastFinishedAt: number;
  refresh: () => Promise<void>;
  markFinished: () => void;
}

let progressTimer: ReturnType<typeof setInterval> | null = null;

export const useBrowserDownloadsStore = create<BrowserDownloadsStore>((set, get) => ({
  entries: [],
  loaded: false,
  error: null,
  lastFinishedAt: 0,
  refresh: async () => {
    try {
      const entries = await browserLibrary.downloads();
      set({ entries, loaded: true, error: null });
    } catch (error) {
      set({ loaded: true, error: error instanceof Error ? error.message : String(error) });
    }
    syncProgressPolling(get().entries);
  },
  markFinished: () => set({ lastFinishedAt: Date.now() }),
}));

/** Poll byte counts only while something is downloading. */
function syncProgressPolling(entries: BrowserDownloadEntry[]): void {
  const active = entries.some((entry) => entry.state === "in_progress");
  if (active && !progressTimer) {
    progressTimer = setInterval(() => void pollProgress(), progressIntervalMs);
  } else if (!active && progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
}

async function pollProgress(): Promise<void> {
  try {
    const progress = await browserLibrary.downloadProgress();
    const byId = new Map(progress.map((item) => [item.id, item]));
    useBrowserDownloadsStore.setState((state) => ({
      entries: state.entries.map((entry) => {
        const update = byId.get(entry.id);
        return update ? { ...entry, received: update.received, total: update.total } : entry;
      }),
    }));
  } catch {
    // Progress is decoration; the finish event still refreshes the list.
  }
}

export function downloadProgressFraction(entry: BrowserDownloadEntry): number | null {
  return entry.total > 0 ? Math.min(1, entry.received / entry.total) : null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
