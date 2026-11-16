import { create } from "zustand";

/*
 * The studio's daily quests: three small goals that start again each day, every one of them real
 * work (tasks finished, agents talked to, a task given to several at once), never time spent or
 * runs started. A quest done is worth points toward the studio's unlocks (`POINTS.quest`), counted
 * once per day on this computer.
 */

export type QuestId = "tasks" | "talk" | "group";

export interface Quest {
  id: QuestId;
  label: string;
  have: number;
  need: number;
}

/** What each quest asks for. */
const NEED: Record<QuestId, number> = { tasks: 3, talk: 2, group: 1 };

/** Today, as this computer's calendar has it. */
export const today = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

/** When today began, in ms. */
export const startOfToday = (now = new Date()) =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

interface Day {
  date: string;
  /** Agents talked to from the studio today. */
  talked: string[];
  /** Tasks given to several agents at once today. */
  groups: number;
}

interface DoneQuests {
  /** `<date>:<quest>` for every quest finished, which is what its points count. */
  done: string[];
}

const DAY = "misty:studio-day";
const DONE = "misty:studio-quests-done";

function read<T>(key: string, fallback: T): T {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "null") as unknown;
    return saved && typeof saved === "object" ? (saved as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Kept for this window only.
  }
}

const freshDay = (): Day => ({ date: today(), talked: [], groups: 0 });

interface QuestState extends DoneQuests {
  day: Day;
  /** Notes an agent talked to from the studio. */
  talked(agentId: string): void;
  /** Notes a task given to several agents at once. */
  grouped(): void;
  /** Counts a quest finished today, once. */
  finish(id: QuestId): void;
}

/** Today's record, started afresh when the date has moved on. */
function current(day: Day): Day {
  return day.date === today() ? day : freshDay();
}

export const useStudioQuests = create<QuestState>((set, get) => ({
  day: current(read<Day>(DAY, freshDay())),
  done: read<DoneQuests>(DONE, { done: [] }).done ?? [],
  talked(agentId) {
    const day = current(get().day);
    if (day.talked.includes(agentId)) return;
    const next = { ...day, talked: [...day.talked, agentId] };
    set({ day: next });
    write(DAY, next);
  },
  grouped() {
    const day = current(get().day);
    const next = { ...day, groups: day.groups + 1 };
    set({ day: next });
    write(DAY, next);
  },
  finish(id) {
    const key = `${today()}:${id}`;
    if (get().done.includes(key)) return;
    const done = [...get().done, key];
    set({ done });
    write(DONE, { done });
  },
}));

/** Today's quests and how far each has got, from the tasks finished today and the day's record. */
export function questsOf(tasksToday: number, day: Day): Quest[] {
  const live = current(day);
  return [
    { id: "tasks", label: `Finish ${NEED.tasks} tasks`, have: tasksToday, need: NEED.tasks },
    { id: "talk", label: `Talk to ${NEED.talk} agents`, have: live.talked.length, need: NEED.talk },
    { id: "group", label: "Give a group task", have: live.groups, need: NEED.group },
  ].map((quest) => ({ ...quest, have: Math.min(quest.have, quest.need) })) as Quest[];
}
