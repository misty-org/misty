import { useBrowserDownloadsStore } from "@/features/browser";
import { browserLibrary, type BrowserDownloadEntry } from "@/features/browser";
import { compatObject, compatTime, emitCompatEvent, type CompatHandler } from "./events";

// WebExtensions identify downloads by integers; Misty's are strings.
const numbers = new Map<string, number>();
const entries = new Map<number, string>();
let nextNumber = 1;

function numberFor(id: string): number {
  let value = numbers.get(id);
  if (value === undefined) {
    value = nextNumber++;
    numbers.set(id, value);
    entries.set(value, id);
  }
  return value;
}

function entryFor(value: unknown): string {
  const id = entries.get(Number(value));
  if (!id) throw new Error(`No download with id ${String(value)}.`);
  return id;
}

function downloadState(entry: BrowserDownloadEntry): string {
  if (entry.state === "in_progress") return "in_progress";
  return entry.state === "finished" ? "complete" : "interrupted";
}

function downloadItem(entry: BrowserDownloadEntry) {
  return {
    id: numberFor(entry.id),
    url: entry.url,
    finalUrl: entry.url,
    filename: entry.path,
    incognito: false,
    danger: "safe",
    mime: "",
    startTime: new Date(entry.startedAt).toISOString(),
    endTime: entry.finishedAt ? new Date(entry.finishedAt).toISOString() : undefined,
    state: downloadState(entry),
    paused: false,
    canResume: false,
    error:
      entry.state === "cancelled"
        ? "USER_CANCELED"
        : entry.state === "failed" || entry.state === "interrupted"
          ? "NETWORK_FAILED"
          : undefined,
    bytesReceived: Math.max(0, entry.received),
    totalBytes: entry.total,
    fileSize: entry.total,
    exists: entry.exists,
  };
}

async function currentEntries(): Promise<BrowserDownloadEntry[]> {
  await useBrowserDownloadsStore.getState().refresh();
  return useBrowserDownloadsStore.getState().entries;
}

function matches(entry: BrowserDownloadEntry, query: Record<string, unknown>): boolean {
  const item = downloadItem(entry);
  if (query.id !== undefined && item.id !== Number(query.id)) return false;
  if (typeof query.url === "string" && entry.url !== query.url) return false;
  if (typeof query.filename === "string" && entry.path !== query.filename) return false;
  if (typeof query.state === "string" && item.state !== query.state) return false;
  if (typeof query.exists === "boolean" && entry.exists !== query.exists) return false;
  if (query.startedAfter !== undefined && entry.startedAt <= compatTime(query.startedAfter, 0))
    return false;
  if (
    query.startedBefore !== undefined &&
    entry.startedAt >= compatTime(query.startedBefore, Infinity)
  )
    return false;
  const terms = Array.isArray(query.query) ? query.query.map(String) : [];
  const text = `${entry.url} ${entry.path}`.toLowerCase();
  return terms.every((term) =>
    term.startsWith("-")
      ? !text.includes(term.slice(1).toLowerCase())
      : text.includes(term.toLowerCase()),
  );
}

async function search(value: unknown): Promise<BrowserDownloadEntry[]> {
  const query = compatObject(value);
  const oldestFirst = Array.isArray(query.orderBy) && query.orderBy[0] === "startTime";
  const found = (await currentEntries())
    .filter((entry) => matches(entry, query))
    .sort((a, b) => (oldestFirst ? a.startedAt - b.startedAt : b.startedAt - a.startedAt));
  const limit = Number(query.limit);
  return limit > 0 ? found.slice(0, limit) : found;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const downloadHandlers: Record<string, CompatHandler> = {
  // The native host has already started the download in a browser tab.
  "downloads.download": async ([options]) => {
    const url = compatObject(options).url;
    const since = Date.now() - 5000;
    for (let attempt = 0; attempt < 30; attempt++) {
      const entry = (await currentEntries()).find(
        (candidate) =>
          candidate.startedAt >= since &&
          (candidate.url === url || String(url).startsWith("data:")),
      );
      if (entry) return numberFor(entry.id);
      await sleep(500);
    }
    throw new Error("The download did not start.");
  },
  "downloads.search": async ([query]) => (await search(query)).map(downloadItem),
  "downloads.cancel": ([id]) => browserLibrary.cancelDownload(entryFor(id)),
  "downloads.open": ([id]) => browserLibrary.openDownload(entryFor(id)),
  "downloads.show": async ([id]) => {
    await browserLibrary.revealDownload(entryFor(id));
    return true;
  },
  "downloads.erase": async ([query]) => {
    const erased = await search(query);
    if (erased.length)
      await browserLibrary.removeDownloads({ ids: erased.map((entry) => entry.id) });
    await useBrowserDownloadsStore.getState().refresh();
    return erased.map((entry) => numberFor(entry.id));
  },
};

/** Reports Misty's download list changes as downloads.onCreated/onChanged/onErased. */
export function watchDownloads(): () => void {
  let previous = new Map(useBrowserDownloadsStore.getState().entries.map((e) => [e.id, e]));
  return useBrowserDownloadsStore.subscribe((state, prior) => {
    const current = new Map(state.entries.map((e) => [e.id, e]));
    // The first load lists existing downloads; they are not new.
    if (!prior.loaded) {
      previous = current;
      return;
    }
    for (const [id, entry] of current) {
      const before = previous.get(id);
      if (!before) {
        emitCompatEvent("downloads.onCreated", [downloadItem(entry)]);
        continue;
      }
      const delta: Record<string, unknown> = { id: numberFor(id) };
      const change = (key: string, from: unknown, to: unknown) => {
        if (from !== to) delta[key] = { previous: from, current: to };
      };
      change("state", downloadState(before), downloadState(entry));
      change("exists", before.exists, entry.exists);
      change("filename", before.path, entry.path);
      if (Object.keys(delta).length > 1) emitCompatEvent("downloads.onChanged", [delta]);
    }
    for (const id of previous.keys())
      if (!current.has(id)) emitCompatEvent("downloads.onErased", [numberFor(id)]);
    previous = current;
  });
}
