import * as Y from "yjs";
import { LiveOrigin, transactAs, transactionAuthor, type LiveRoom } from "./liveRoom";
import {
  addRange,
  baseName,
  itemText,
  lineCount,
  positionAt,
  resolvePosition,
  rewriteText,
  splitItem,
  type ClockRanges,
} from "./liveText";
import { authorKey, type LiveStep, type StepAuthor } from "./liveTypes";

/**
 * The history's steps, recorded by each window for its own authors (the person and their
 * agents): one author's work on one file, closed when they save, after `idleMs` without a
 * change, or when one of their agent's runs ends. While open, a step only remembers which
 * characters its author inserted and deleted, by their ids; closing it turns those into relative
 * positions (inserted ranges, and deleted text with where it was), which every member resolves
 * the same way however the text moved since.
 */

const idleMs = 30_000;

interface OpenStep {
  author: StepAuthor;
  key: string;
  path: string;
  text: Y.Text;
  inserted: ClockRanges;
  deleted: ClockRanges;
  timer: number;
}

export interface StepRecorder {
  /** Closes every open step of this author: a save, or the end of an agent's run. */
  closeAuthor(key: string): void;
  closeAll(): void;
  /** Closes one author's step on one file at once, with its own wording. */
  closeNow(author: StepAuthor, path: string, label: string): void;
  stop(): void;
}

/** Why some local transactions are no one's work: seeding, the history itself, the people list. */
const notWork = new Set<LiveOrigin["reason"]>(["seed", "step", "people"]);

export function startStepRecorder(room: LiveRoom): StepRecorder {
  const open = new Map<string, OpenStep>();
  const labels = new Map<OpenStep, string>();

  const observer = (
    events: Array<Y.YEvent<Y.AbstractType<unknown>>>,
    transaction: Y.Transaction,
  ) => {
    if (!transaction.local) return;
    const origin = transaction.origin;
    if (origin instanceof LiveOrigin && notWork.has(origin.reason)) return;
    const author = transactionAuthor(room, transaction);
    for (const event of events) {
      const path = event.path[0];
      if (!(event.target instanceof Y.Text) || typeof path !== "string") continue;
      note(author, path, event.target, event);
    }
  };

  function note(
    author: StepAuthor,
    path: string,
    text: Y.Text,
    event: Y.YEvent<Y.AbstractType<unknown>>,
  ) {
    const key = authorKey(author);
    const id = `${key}\n${path}`;
    let step = open.get(id);
    // A file whose text was replaced (another member's seed won) starts a new step.
    if (step && step.text !== text) close(step);
    step = open.get(id);
    if (!step) {
      step = { author, key, path, text, inserted: new Map(), deleted: new Map(), timer: 0 };
      open.set(id, step);
    }
    for (let item = text._start; item; item = item.right) {
      if (!item.countable) continue;
      const { client, clock } = item.id;
      if (event.adds(item)) {
        if (!item.deleted) addRange(step.inserted, client, clock, clock + item.length);
      } else if (event.deletes(item)) {
        // Text this same step typed and took back again is no part of it.
        for (const [offset, length, inside] of splitItem(
          step.inserted.get(client),
          clock,
          item.length,
        ))
          if (!inside) addRange(step.deleted, client, clock + offset, clock + offset + length);
      }
    }
    window.clearTimeout(step.timer);
    const current = step;
    step.timer = window.setTimeout(() => close(current), idleMs);
  }

  function close(step: OpenStep) {
    window.clearTimeout(step.timer);
    open.delete(`${step.key}\n${step.path}`);
    const label = labels.get(step) ?? "Edited";
    labels.delete(step);
    if (room.files.get(step.path) !== step.text) return;
    const built = buildStep(step);
    if (!built) return;
    const { inserted, deleted, plus, minus } = built;
    const record: LiveStep = {
      id: crypto.randomUUID(),
      author: step.author,
      path: step.path,
      at: Date.now(),
      summary: `${label} ${baseName(step.path)}, +${plus} −${minus}`,
      inserted,
      deleted,
    };
    room.doc.transact(() => room.steps.push([record]), new LiveOrigin(room.me, "step"));
  }

  room.files.observeDeep(observer);
  return {
    closeAuthor(key) {
      for (const step of [...open.values()]) if (step.key === key) close(step);
    },
    closeAll() {
      for (const step of [...open.values()]) close(step);
    },
    closeNow(author, path, label) {
      const step = open.get(`${authorKey(author)}\n${path}`);
      if (!step) return;
      labels.set(step, label);
      close(step);
    },
    stop() {
      room.files.unobserveDeep(observer);
      for (const step of open.values()) window.clearTimeout(step.timer);
      open.clear();
    },
  };
}

/** An open step as the history keeps it, by one walk over the file's text. */
function buildStep(step: OpenStep) {
  const inserted: LiveStep["inserted"] = [];
  const deleted: LiveStep["deleted"] = [];
  let run: { start: Y.ID; end: Y.ID; text: string } | null = null;
  let gap: { at: Y.ID; text: string } | null = null;
  let plus = 0;
  let minus = 0;
  const endRun = () => {
    if (!run) return;
    inserted.push({
      start: positionAt(step.text, run.start, 0),
      end: positionAt(step.text, run.end, -1),
    });
    plus += lineCount(run.text);
    run = null;
  };
  const endGap = () => {
    if (!gap) return;
    deleted.push({ at: positionAt(step.text, gap.at, 0), text: gap.text });
    minus += lineCount(gap.text);
    gap = null;
  };
  for (let item = step.text._start; item; item = item.right) {
    const content = item.countable ? itemText(item) : null;
    if (content === null) continue;
    const { client, clock } = item.id;
    if (!item.deleted) {
      // Something still there between two deletions ends the deleted run.
      endGap();
      for (const [offset, length, inside] of splitItem(
        step.inserted.get(client),
        clock,
        item.length,
      )) {
        if (!inside) {
          endRun();
          continue;
        }
        const piece = content.slice(offset, offset + length);
        const last = Y.createID(client, clock + offset + length - 1);
        if (run) {
          run.end = last;
          run.text += piece;
        } else run = { start: Y.createID(client, clock + offset), end: last, text: piece };
      }
    } else {
      // Deleted characters take no room, so they don't split an inserted run.
      for (const [offset, length, inside] of splitItem(
        step.deleted.get(client),
        clock,
        item.length,
      )) {
        if (!inside) continue;
        const piece = content.slice(offset, offset + length);
        if (gap) gap.text += piece;
        else gap = { at: Y.createID(client, clock + offset), text: piece };
      }
    }
  }
  endRun();
  endGap();
  if (!inserted.length && !deleted.length) return null;
  return { inserted, deleted, plus, minus };
}

/**
 * The text a step's file would have without that step: its inserted ranges gone and its deleted
 * text back where it was, worked out on the current text without changing it.
 */
export function textWithoutStep(text: Y.Text, step: LiveStep): string {
  const current = text.toString();
  const cuts: Array<[number, number]> = [];
  for (const range of step.inserted) {
    const start = resolvePosition(text, range.start);
    const end = resolvePosition(text, range.end);
    if (start !== null && end !== null && end > start) cuts.push([start, end]);
  }
  const puts: Array<[number, string]> = [];
  for (const piece of step.deleted) {
    const at = resolvePosition(text, piece.at);
    if (at !== null && piece.text) puts.push([at, piece.text]);
  }
  puts.sort((a, b) => a[0] - b[0]);
  const cut = (index: number) => cuts.some(([start, end]) => index >= start && index < end);
  let out = "";
  let put = 0;
  for (let index = 0; index <= current.length; index++) {
    while (put < puts.length && puts[put]![0] === index) out += puts[put++]![1];
    if (index < current.length && !cut(index)) out += current[index];
  }
  return out;
}

/**
 * Undoes one step as a new change by the person, never rewriting the history: its inserted text
 * goes and its deleted text comes back, wherever they are now.
 */
export function undoStep(room: LiveRoom, recorder: StepRecorder, step: LiveStep): boolean {
  const text = room.files.get(step.path);
  if (!text) return false;
  const next = textWithoutStep(text, step);
  if (next === text.toString()) return false;
  transactAs(room, room.me, "undo", () => rewriteText(text, next));
  recorder.closeNow(room.me, step.path, "Undid a step in");
  return true;
}
