import { create } from "zustand";
import type { MistyActivityEntry } from "../conversations/state/activity";
import { mainKindOf } from "./doing";
import { furniture, type FurnitureKind } from "./studio/catalog";
import { ROOM, type RoomSize } from "./studio/grid";

/*
 * What a studio earns. Points come from real work and from the Space growing, never from merely
 * starting runs, so spending usage earns nothing: each finished task, each agent on the team, each
 * other member, the Space's notes and the games its agents made. Points unlock furniture and room
 * to grow into, one step at a time, and a trophy for every step reached.
 */

/** What each thing the studio has done is worth. */
export const POINTS = {
  task: 1,
  agent: 2,
  member: 3,
  /** For every two notes. */
  notes: 1,
  game: 4,
  /** For each daily quest finished. */
  quest: 2,
} as const;

export interface StudioTally {
  tasks: number;
  agents: number;
  /** Members besides the person. */
  members: number;
  notes: number;
  games: number;
  /** Daily quests finished, every day counted. */
  quests: number;
}

export const pointsOf = (tally: StudioTally): number =>
  tally.tasks * POINTS.task +
  tally.agents * POINTS.agent +
  tally.members * POINTS.member +
  Math.floor(tally.notes / 2) * POINTS.notes +
  tally.games * POINTS.game +
  tally.quests * POINTS.quest;

/** A step up: a piece of furniture, or a bigger room. */
export type Unlock =
  | { id: string; at: number; kind: FurnitureKind }
  | { id: string; at: number; room: RoomSize };

/** Every unlock, in the order they are reached. */
export const unlocks: Unlock[] = [
  { id: "beanbag", at: 5, kind: "beanbag" },
  { id: "arcade", at: 12, kind: "arcade" },
  { id: "room-1", at: 20, room: { w: 42, d: 28 } },
  { id: "aquarium", at: 30, kind: "aquarium" },
  { id: "trophies", at: 45, kind: "trophies" },
  { id: "vending", at: 60, kind: "vending" },
  { id: "room-2", at: 80, room: { w: 48, d: 32 } },
  { id: "tree", at: 100, kind: "tree" },
  { id: "room-3", at: 140, room: { ...ROOM.most } },
];

/** What an unlock is called, for the goal it is and the note that it came. */
export const unlockLabel = (unlock: Unlock): string =>
  "kind" in unlock ? furniture[unlock.kind].label : `Room up to ${unlock.room.w}×${unlock.room.d}`;

/** Pieces that have to be earned; every other piece is there from the start. */
const earned = new Set<FurnitureKind>(
  unlocks.flatMap((unlock) => ("kind" in unlock ? [unlock.kind] : [])),
);
export const isEarnedKind = (kind: FurnitureKind) => earned.has(kind);

export interface Progress {
  points: number;
  reached: Unlock[];
  next: Unlock | null;
  /** Where the step before the next one was, so the bar fills from there. */
  from: number;
  /** The furniture that can be placed. */
  kinds: Set<FurnitureKind>;
  /** The biggest room it may grow to. */
  room: RoomSize;
}

export function progressOf(points: number): Progress {
  const reached = unlocks.filter((unlock) => unlock.at <= points);
  const next = unlocks.find((unlock) => unlock.at > points) ?? null;
  const room = reached.reduce<RoomSize>(
    (biggest, unlock) => ("room" in unlock ? unlock.room : biggest),
    { ...ROOM.start },
  );
  const kinds = new Set<FurnitureKind>(
    (Object.keys(furniture) as FurnitureKind[]).filter((kind) => !earned.has(kind)),
  );
  for (const unlock of reached) if ("kind" in unlock) kinds.add(unlock.kind);
  return { points, reached, next, from: reached.at(-1)?.at ?? 0, kinds, room };
}

/*
 * The record of finished tasks. The activity the room reads only keeps recent runs, so every run
 * seen to finish is kept here, on this computer, for the account: the tally only ever grows.
 */

interface Ran {
  agent: string;
  ok: boolean;
  /** When it ended, in ms. */
  at: number;
  /** The kind of work it did most (`doing.ts` codes); missing on runs noted before it was kept. */
  kind?: string;
}

const LEDGER = "misty:studio-record:";
/** The most runs kept; the oldest go first. */
const KEEP = 4000;

function readLedger(account: string): Record<string, Ran> {
  try {
    const saved = JSON.parse(localStorage.getItem(LEDGER + account) ?? "{}") as unknown;
    return saved && typeof saved === "object" ? (saved as Record<string, Ran>) : {};
  } catch {
    return {};
  }
}

function writeLedger(account: string, runs: Record<string, Ran>) {
  try {
    localStorage.setItem(LEDGER + account, JSON.stringify(runs));
  } catch {
    // Without storage the record lasts as long as the window.
  }
}

interface LedgerState {
  account: string;
  runs: Record<string, Ran>;
  /** Notes every run in `entries` that has finished. */
  note(account: string, entries: readonly MistyActivityEntry[]): void;
}

export const useStudioLedger = create<LedgerState>((set, get) => ({
  account: "",
  runs: {},
  note(account, entries) {
    const state = get();
    let runs = state.account === account ? state.runs : readLedger(account);
    let changed = state.account !== account;
    for (const entry of entries) {
      if (!entry.agent_id || entry.delegation_depth > 0) continue;
      if (entry.state !== "completed" && entry.state !== "failed") continue;
      if (runs[entry.run_id]) continue;
      if (!changed) runs = { ...runs };
      changed = true;
      runs[entry.run_id] = {
        agent: entry.agent_id,
        ok: entry.state === "completed",
        at: Date.parse(entry.updated_at) || Date.now(),
        kind: mainKindOf(entry) || undefined,
      };
    }
    if (!changed) return;
    const ids = Object.keys(runs);
    if (ids.length > KEEP) {
      const oldest = ids.sort((a, b) => runs[a]!.at - runs[b]!.at).slice(0, ids.length - KEEP);
      for (const id of oldest) delete runs[id];
    }
    set({ account, runs });
    writeLedger(account, runs);
  },
}));

/** One agent's record in the studio: what its card shows. */
export interface AgentRecord {
  done: number;
  failed: number;
  /** The most tasks it has finished in a row without one failing. */
  bestStreak: number;
  /** Days on which it finished something. */
  days: number;
  level: number;
  /** Tasks done toward the next level, and how many that level takes. */
  toNext: { have: number; need: number } | null;
  /** What it is good at: the kinds of work its finished tasks were mostly, most first. */
  skills: { code: string; tasks: number }[];
}

/** Finished tasks of one kind that make it a skill, and the most skills a record shows. */
const SKILL_AT = 2;
const MOST_SKILLS = 3;

function skillsOf(list: readonly Ran[]): AgentRecord["skills"] {
  const counts = new Map<string, number>();
  for (const ran of list) if (ran.ok && ran.kind) counts.set(ran.kind, (counts.get(ran.kind) ?? 0) + 1);
  return [...counts]
    .filter(([, tasks]) => tasks >= SKILL_AT)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MOST_SKILLS)
    .map(([code, tasks]) => ({ code, tasks }));
}

/** Finished tasks each level starts at. */
const LEVELS = [0, 3, 8, 15, 25, 40, 60, 85, 115, 150, 200];

export function levelOf(done: number): Pick<AgentRecord, "level" | "toNext"> {
  let level = 1;
  for (let index = 1; index < LEVELS.length; index += 1) if (done >= LEVELS[index]!) level += 1;
  const from = LEVELS[level - 1]!;
  const to = LEVELS[level];
  return { level, toNext: to === undefined ? null : { have: done - from, need: to - from } };
}

export function recordsOf(runs: Record<string, Ran>): Map<string, AgentRecord> {
  const byAgent = new Map<string, Ran[]>();
  for (const ran of Object.values(runs)) {
    const list = byAgent.get(ran.agent) ?? [];
    list.push(ran);
    byAgent.set(ran.agent, list);
  }
  const records = new Map<string, AgentRecord>();
  for (const [agent, list] of byAgent) {
    list.sort((a, b) => a.at - b.at);
    let streak = 0;
    let bestStreak = 0;
    const days = new Set<string>();
    for (const ran of list) {
      streak = ran.ok ? streak + 1 : 0;
      bestStreak = Math.max(bestStreak, streak);
      if (ran.ok) days.add(new Date(ran.at).toDateString());
    }
    const done = list.filter((ran) => ran.ok).length;
    records.set(agent, {
      done,
      failed: list.length - done,
      bestStreak,
      days: days.size,
      ...levelOf(done),
      skills: skillsOf(list),
    });
  }
  return records;
}

/*
 * Which unlocks the person has already been told about, per Space, so each is celebrated once.
 */

const SEEN = "misty:studio-unlocks-seen:";

export function seenUnlocks(space: string): Set<string> | null {
  try {
    const saved = localStorage.getItem(SEEN + space);
    return saved ? new Set(JSON.parse(saved) as string[]) : null;
  } catch {
    return null;
  }
}

export function markUnlocksSeen(space: string, ids: Iterable<string>) {
  try {
    localStorage.setItem(SEEN + space, JSON.stringify([...ids]));
  } catch {
    // Without storage an unlock may be celebrated again next time.
  }
}
