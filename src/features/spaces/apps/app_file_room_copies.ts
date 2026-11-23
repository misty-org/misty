import * as Y from "yjs";
import { conflictedCopyName } from "../drive/drive_app_files";
import { driveEntryById, driveNative, driveParent, type DriveEntry } from "../drive/drive_native";
import { withTimeout } from "../journal/notes/create_yjs_provider";
import { FILE_TEXT, sameBytes } from "./app_file_room_marks";

const MAX_PAUSED_BYTES = 16 * 1024 * 1024;

export const REPLAYED = Symbol("misty-file-room-replayed");

export interface PausedEdits {
  readonly count: number;
  readonly lost: boolean;
  push(update: Uint8Array): void;
  replay(doc: Y.Doc): void;
  clear(): void;
  textWith(doc: Y.Doc): string;
}

function heldWith(held: Uint8Array | null, update: Uint8Array): Uint8Array | null {
  if (!held) return update.slice();
  const merged = Y.mergeUpdates([held, update]);
  const same =
    merged.byteLength <= held.byteLength &&
    sameBytes(Y.encodeStateVectorFromUpdate(merged), Y.encodeStateVectorFromUpdate(held));
  return same ? null : merged;
}

export function pausedEdits(): PausedEdits {
  let held: Uint8Array | null = null;
  let count = 0;
  let lost = false;
  const clear = () => {
    held = null;
    count = 0;
    lost = false;
  };
  return {
    get count() {
      return count;
    },
    get lost() {
      return lost;
    },
    push(update) {
      count += 1;
      if (lost) return;
      let next: Uint8Array | null;
      try {
        next = heldWith(held, update);
      } catch {
        lost = true;
        return;
      }
      if (!next) {
        count -= 1;
        return;
      }
      if (next.byteLength > MAX_PAUSED_BYTES) {
        lost = true;
        return;
      }
      held = next;
    },
    replay(doc) {
      const queued = held;
      clear();
      if (queued) Y.applyUpdate(doc, queued, REPLAYED);
    },
    clear,
    textWith(doc) {
      if (!held) return doc.getText(FILE_TEXT).toString();
      const scratch = new Y.Doc({ gc: false });
      try {
        Y.applyUpdate(scratch, Y.encodeStateAsUpdate(doc));
        Y.applyUpdate(scratch, held);
        return scratch.getText(FILE_TEXT).toString();
      } finally {
        scratch.destroy();
      }
    },
  };
}

export interface KeepAsks {
  ask(boundMs: number): Promise<Uint8Array | null>;
  answer(request: number, data: Uint8Array | null): boolean;
  cancel(): void;
}

export function keepAsks(ask: (request: number) => void, next: () => number): KeepAsks {
  let pending: { request: number; settle: (data: Uint8Array | null) => void } | null = null;
  const settle = (data: Uint8Array | null) => {
    const asked = pending;
    pending = null;
    asked?.settle(data);
  };
  return {
    ask: (boundMs) =>
      new Promise<Uint8Array | null>((resolve) => {
        settle(null);
        const request = next();
        const bound = setTimeout(() => {
          if (pending?.request === request) settle(null);
        }, boundMs);
        pending = {
          request,
          settle: (data) => {
            clearTimeout(bound);
            resolve(data);
          },
        };
        ask(request);
      }),
    answer(request, data) {
      if (pending?.request !== request) return false;
      settle(data);
      return true;
    },
    cancel: () => settle(null),
  };
}

export async function writeConflictedCopy(
  spaceId: string,
  entry: DriveEntry,
  data: Uint8Array,
  boundMs: number,
): Promise<string | null> {
  try {
    const now = (await driveEntryById(spaceId, entry.id).catch(() => null)) ?? entry;
    const written = await withTimeout(
      driveNative.write(spaceId, driveParent(now.path), conflictedCopyName(now.name, new Date()), data),
      boundMs,
      "The copy wasn't saved in time.",
    );
    return written.name;
  } catch {
    return null;
  }
}
