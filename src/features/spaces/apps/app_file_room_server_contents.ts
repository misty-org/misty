import { spaceRequest } from "../api/api";
import type { DriveChanged, DriveEntry } from "../drive/drive_native";
import { withTimeout } from "../journal/notes/create_yjs_provider";

export const SERVER_CONTENT_BOUND_MS = 5_000;
export const SERVER_CONTENT_RETRY_MS = 60_000;

interface ServerVersions {
  version: number;
  content: number;
}

export interface ServerContents {
  entry(entry: DriveEntry): Promise<DriveEntry>;
  events(listener: (changed: DriveChanged) => void): (changed: DriveChanged) => void;
}

const positive = (value: unknown) => (typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined);

export function serverContents(spaceId: string, itemId: string): ServerContents {
  const path = `/spaces/${encodeURIComponent(spaceId)}/drive/items/${encodeURIComponent(itemId)}`;
  let known: ServerVersions | null = null;
  let unsupported = false;
  let queue: Promise<void> | null = null;
  let failed: { at: number; version: number } | null = null;
  const resting = (entry: DriveEntry) =>
    failed !== null && Date.now() - failed.at < SERVER_CONTENT_RETRY_MS && (entry.version ?? 0) < failed.version + 2;
  const fill = (entry: DriveEntry): DriveEntry | null => {
    if (typeof entry.content_version === "number") return entry;
    const version = entry.version ?? 0;
    return known && known.content <= version && version <= known.version ? { ...entry, content_version: known.content } : null;
  };
  const read = async (entry: DriveEntry): Promise<DriveEntry> => {
    const filled = fill(entry);
    if (filled || unsupported || !entry.version || resting(entry)) return filled ?? entry;
    const asked = entry.version;
    try {
      const answer = await withTimeout(
        spaceRequest<{ version?: unknown; content_version?: unknown } | undefined>(path, {
          signal: AbortSignal.timeout(SERVER_CONTENT_BOUND_MS),
        }),
        SERVER_CONTENT_BOUND_MS,
        "The drive's versions didn't arrive in time.",
      );
      const version = positive(answer?.version);
      const content = positive(answer?.content_version);
      if (version !== undefined && content === undefined) unsupported = true;
      if (version !== undefined && content !== undefined && content <= version && version >= (known?.version ?? 0))
        known = { version, content };
      failed = null;
    } catch {
      failed = { at: Date.now(), version: asked };
      return entry;
    }
    return fill(entry) ?? entry;
  };
  const withItem = (changed: DriveChanged, item: DriveChanged["items"][number]): DriveChanged => ({
    ...changed,
    items: changed.items.map((each) => (each.id === itemId ? item : each)),
  });
  return {
    entry: read,
    events(listener) {
      return (changed) => {
        const mine = changed.space_id === spaceId ? changed.items.find((item) => item.id === itemId) : undefined;
        const live = mine && !mine.removed && !mine.trashed ? mine : undefined;
        const filled = live ? fill(live) : null;
        if (!queue && (!live || filled || unsupported || resting(live))) {
          listener(live && filled && filled !== live ? withItem(changed, { ...live, ...filled }) : changed);
          return;
        }
        const next = (queue ?? Promise.resolve())
          .then(async () => {
            const item = live ? await read(live) : undefined;
            listener(live && item && item !== live ? withItem(changed, { ...live, ...item }) : changed);
          })
          .catch(() => undefined);
        queue = next;
        void next.then(() => {
          if (queue === next) queue = null;
        });
      };
    },
  };
}
