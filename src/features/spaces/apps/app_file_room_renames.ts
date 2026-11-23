import type { DriveEntry } from "../drive/drive_native";

const MAX_RENAMES = 16;

export const settledOnServer = (state: DriveEntry["state"]) =>
  state !== "uploading" && state !== "not_synced" && state !== "conflict";

export interface Rename {
  from: number;
  to: number;
}

export const renameOf = (before: DriveEntry, after: DriveEntry): Rename | null => {
  const from = before.version ?? 0;
  const to = after.version ?? 0;
  if (to <= from || after.size !== before.size) return null;
  if (!settledOnServer(before.state) || !settledOnServer(after.state)) return null;
  const timed = typeof before.mtime_ms === "number" && typeof after.mtime_ms === "number";
  if (timed && after.mtime_ms !== before.mtime_ms) return null;
  const moved = after.path !== before.path || after.name !== before.name;
  return moved || (timed && to === from + 1) ? { from, to } : null;
};

const samePlace = (one: DriveEntry, other: DriveEntry) => one.path === other.path && one.name === other.name;

export function renamesSince(first: DriveEntry): (next: DriveEntry) => Rename | null {
  let lastSettled: DriveEntry | null = settledOnServer(first.state) ? first : null;
  return (next) => {
    if (!settledOnServer(next.state)) return null;
    const last = lastSettled;
    const rename = last ? renameOf(last, next) : null;
    const was = last?.version ?? 0;
    const now = next.version ?? 0;
    if (!last || now > was || (now === was && samePlace(last, next))) lastSettled = next;
    return rename;
  };
}

export interface RenameDeps {
  base(): number;
  serverBase(): number | undefined;
  links(): number;
  send(version: number): boolean;
}

export interface Renames {
  known(): number;
  note(rename: Rename): void;
  heard(version: number): void;
  content(version: number): number;
  from(version: number): number | undefined;
  tell(): void;
}

export function renameFloor(deps: RenameDeps): Renames {
  let floor = 0;
  let roomKnows = 0;
  let told = "";
  const seen = new Map<number, number>();
  const settle = () => {
    for (let grew = true; grew; ) {
      grew = false;
      const now = Math.max(deps.base(), floor);
      for (const [to, from] of seen)
        if (to > floor && to > now && from <= now) {
          floor = to;
          grew = true;
        }
    }
    return Math.max(deps.base(), floor);
  };
  const tell = () => {
    settle();
    const key = `${floor}:${deps.links()}`;
    if (floor <= Math.max(deps.serverBase() ?? 0, roomKnows) || told === key || !deps.send(floor)) return;
    told = key;
  };
  const known = () => {
    const was = floor;
    const now = settle();
    if (floor > was) tell();
    return now;
  };
  return {
    known,
    note(rename) {
      if (rename.to <= known()) return;
      seen.delete(rename.to);
      seen.set(rename.to, rename.from);
      for (const to of seen.keys()) {
        if (seen.size <= MAX_RENAMES) break;
        seen.delete(to);
      }
      known();
    },
    heard(version) {
      roomKnows = Math.max(roomKnows, version);
      floor = Math.max(floor, version);
      known();
    },
    content(version) {
      const now = known();
      let at = version;
      for (let from = seen.get(at); from !== undefined && at > now; from = seen.get(at)) at = from;
      return at;
    },
    from: (version) => seen.get(version),
    tell,
  };
}

export interface ContentDeps {
  base(): number;
  entry(): DriveEntry;
  fallback: { known(): number };
  links?(): number;
  say?(message: object): boolean;
}

export interface Contents {
  note(entry: DriveEntry): boolean;
  known(): number;
  same(entry: DriveEntry, version: number): boolean;
  tell(): void;
}

const contentOf = (entry: DriveEntry) => (typeof entry.content_version === "number" ? entry.content_version : undefined);

export function contentFloor(deps: ContentDeps): Contents {
  let floor = 0;
  let toldLink: number | undefined;
  const tell = (entry: DriveEntry) => {
    const link = deps.links?.();
    if (link === undefined || link === toldLink || contentOf(entry) === undefined) return;
    if (deps.say?.({ type: "file_mode", content: true })) toldLink = link;
  };
  const note = (entry: DriveEntry) => {
    const content = contentOf(entry);
    if (content === undefined) return false;
    tell(entry);
    if (settledOnServer(entry.state) && content <= deps.base()) floor = Math.max(floor, entry.version ?? 0);
    return true;
  };
  return {
    note,
    known: () => (note(deps.entry()) ? Math.max(deps.base(), floor) : deps.fallback.known()),
    same(entry, version) {
      const content = contentOf(entry);
      return content !== undefined && settledOnServer(entry.state) && content <= version;
    },
    tell: () => tell(deps.entry()),
  };
}
