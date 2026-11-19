import { diff } from "@codemirror/merge";
import { ChangeSet } from "@codemirror/state";
import * as Y from "yjs";
import type { RelativeJson } from "./liveTypes";

const diffLimits = { scanLimit: 20_000, timeout: 200 };
/** Change sets keep a file's own line endings: no line is ever split on "\r\n". */
const noLineSplit = "\u0000";

/**
 * Turns a shared text into `next` with the smallest edits, so the characters that didn't change
 * keep their authors and everyone's cursors stay where they were. Call it inside a transaction.
 */
export function rewriteText(text: Y.Text, next: string) {
  const current = text.toString();
  if (current === next) return;
  const changes = diff(current, next, diffLimits);
  // From the end, so earlier offsets still hold.
  for (let index = changes.length - 1; index >= 0; index--) {
    const change = changes[index]!;
    if (change.toA > change.fromA) text.delete(change.fromA, change.toA - change.fromA);
    if (change.toB > change.fromB) text.insert(change.fromA, next.slice(change.fromB, change.toB));
  }
}

/**
 * An edit made on disk, as edits to the shared text: what changed from `base` (the file as Misty
 * last wrote or read it) to `outside`, carried over everything the session changed since, so
 * nothing another member typed meanwhile is lost. Offsets are in `current`, last edit first.
 */
export function outsideEdits(
  current: string,
  base: string,
  outside: string,
): Array<{ from: number; to: number; insert: string }> {
  const toChanges = (from: string, to: string) =>
    ChangeSet.of(
      diff(from, to, diffLimits).map((change) => ({
        from: change.fromA,
        to: change.toA,
        insert: to.slice(change.fromB, change.toB),
      })),
      from.length,
      noLineSplit,
    );
  const theirs = toChanges(base, outside);
  const mapped = base === current ? theirs : theirs.map(toChanges(base, current));
  const edits: Array<{ from: number; to: number; insert: string }> = [];
  mapped.iterChanges((fromA, toA, _fromB, _toB, inserted) =>
    edits.push({ from: fromA, to: toA, insert: inserted.toString() }),
  );
  return edits.reverse();
}

/** Where a relative position falls in `text` now, or null when it belongs to another text. */
export function resolvePosition(text: Y.Text, json: RelativeJson): number | null {
  const doc = text.doc;
  if (!doc) return null;
  const absolute = Y.createAbsolutePositionFromRelativePosition(
    Y.createRelativePositionFromJSON(json),
    doc,
  );
  return absolute && absolute.type === text ? absolute.index : null;
}

/** A position at one character of `text`, by the character's id. */
export function positionAt(text: Y.Text, id: Y.ID, assoc: 0 | -1): RelativeJson {
  const type = text._item?.id;
  return {
    type: type ? { client: type.client, clock: type.clock } : undefined,
    item: { client: id.client, clock: id.clock },
    assoc,
  };
}

/** How many lines a run of text touches: "a" is one, "a\nb\n" two. */
export function lineCount(text: string): number {
  if (!text) return 0;
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

/** The file's name without its folders, for one-line summaries. */
export const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1) || path;

/** The string content of a text item, or null for anything else (embeds, formats). */
export function itemText(item: Y.Item): string | null {
  return item.content instanceof Y.ContentString ? item.content.str : null;
}

/**
 * Splits an item's characters by whether their ids fall in `ranges` (clock spans of one
 * client): `[offset, length, inside]` in order.
 */
export function splitItem(
  ranges: ReadonlyArray<readonly [number, number]> | undefined,
  clock: number,
  length: number,
): Array<[number, number, boolean]> {
  const parts: Array<[number, number, boolean]> = [];
  let at = clock;
  const end = clock + length;
  for (const [from, to] of ranges ?? []) {
    if (to <= at || from >= end) continue;
    if (from > at) parts.push([at - clock, from - at, false]);
    const stop = Math.min(to, end);
    parts.push([Math.max(from, at) - clock, stop - Math.max(from, at), true]);
    at = stop;
  }
  if (at < end) parts.push([at - clock, end - at, false]);
  return parts;
}

/** Clock spans by client, kept sorted and merged. */
export type ClockRanges = Map<number, Array<[number, number]>>;

export function addRange(ranges: ClockRanges, client: number, from: number, to: number) {
  if (to <= from) return;
  const list = [...(ranges.get(client) ?? []), [from, to] as [number, number]].sort(
    (a, b) => a[0] - b[0],
  );
  const merged: Array<[number, number]> = [];
  for (const span of list) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([span[0], span[1]]);
  }
  ranges.set(client, merged);
}
