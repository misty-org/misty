import { hashOf } from "./look";
import type { StudioPlaces, Spot } from "./places";

/** Anyone in the studio: one of the person's own agents, or a teammate's agent that is visiting. */
export interface Actor {
  id: string;
  name: string;
  /** For a visitor, the person it belongs to. */
  owner: string;
  guest: boolean;
  state: "working" | "needs-you" | "resting";
  doing: string;
  doingCode: string;
  /** What the agent is for, in its person's words; empty when none was given. */
  role?: string;
  /** What its current run was asked to do; empty while it rests. */
  task?: string;
  /** The engine it runs on, whose mark its name tag wears. */
  engine?: string;
  /** Working on a task given to several agents at once, so it works at the meeting table. */
  huddle?: boolean;
  /** How its latest run ended, while it rests and the person hasn't looked yet. */
  outcome?: "done" | "failed" | "";
}

/** What a figure does once it has arrived. */
export type Activity = "type" | "talk" | "wave" | "relax";

export interface Goal {
  spot: Spot;
  activity: Activity;
  /** For a resting figure, which spell of rest this place is for; it moves on when that ends. */
  spell?: number;
}

/** Ticks between two changes of place for a resting figure. */
export const RESTLESS_TICKS = 3;

/** Every spot by its id, so a goal from the last plan can find its place in a rebuilt room. */
function spotsById(places: StudioPlaces): Map<string, Spot> {
  const all = new Map<string, Spot>();
  for (const spot of places.desks.values()) all.set(spot.id, spot);
  for (const list of [places.lounge, places.meeting, places.mingle, places.door])
    for (const spot of list) all.set(spot.id, spot);
  return all;
}

/**
 * Where everyone goes and what they do there. An agent that needs its person waits at the door and
 * waves; a working one types at its desk, or stands at the meeting table while it works with other
 * agents or has no desk; a resting one drifts between the lounge and the places to hang about,
 * moving on every few ticks. No two figures are sent to the same place.
 *
 * A figure keeps the place it was given last time for as long as that still fits what it is doing,
 * and is given first claim on it, so one agent changing never sends the others across the room.
 */
export function planGoals(
  actors: Actor[],
  places: StudioPlaces,
  desks: Map<string, string>,
  tick: number,
  previous: Map<string, Goal> = new Map(),
): Map<string, Goal> {
  const goals = new Map<string, Goal>();
  const taken = new Set<string>();
  const take = (list: Spot[], start: number): Spot | null => {
    for (let index = 0; index < list.length; index += 1) {
      const spot = list[(start + index) % list.length]!;
      if (taken.has(spot.id)) continue;
      taken.add(spot.id);
      return spot;
    }
    return null;
  };
  const anywhere = (start: number) =>
    take(places.mingle, start) ??
    take(places.lounge, start) ??
    take(places.meeting, start) ??
    take(places.door, start);
  const rank = { "needs-you": 0, working: 1, resting: 2 };
  const ordered = [...actors].sort((a, b) => rank[a.state] - rank[b.state]);
  const spellOf = (actor: Actor) =>
    Math.floor((tick + (hashOf(actor.id) % RESTLESS_TICKS)) / RESTLESS_TICKS);
  const deskOf = (actor: Actor) =>
    actor.guest ? undefined : places.desks.get(desks.get(actor.id) ?? "");
  const atTable = (actor: Actor) => actor.doingCode === "agents" || Boolean(actor.huddle);

  /** What the figure should be doing now, and the places that would do for it. */
  const wants = (actor: Actor): { activity: Activity; fits: (spot: Spot) => boolean } => {
    if (actor.state === "needs-you")
      return { activity: "wave", fits: (spot) => spot.id.startsWith("door:") };
    if (actor.state === "working") {
      const desk = deskOf(actor);
      if (desk && !atTable(actor)) return { activity: "type", fits: (spot) => spot.id === desk.id };
      const meeting = new Set(places.meeting.map((spot) => spot.id));
      return { activity: "talk", fits: (spot) => meeting.has(spot.id) };
    }
    const rest = new Set([...places.lounge, ...places.mingle].map((spot) => spot.id));
    return { activity: "relax", fits: (spot) => rest.has(spot.id) };
  };

  // First, everyone whose last place still fits keeps it.
  const byId = spotsById(places);
  for (const actor of ordered) {
    const last = previous.get(actor.id);
    if (!last) continue;
    const spot = byId.get(last.spot.id);
    const want = wants(actor);
    if (!spot || taken.has(spot.id) || last.activity !== want.activity || !want.fits(spot))
      continue;
    const spell = spellOf(actor);
    if (want.activity === "relax" && last.spell !== spell) continue;
    taken.add(spot.id);
    goals.set(actor.id, { spot, activity: want.activity, spell });
  }

  // Then everyone else is found a place, in order of how much it matters where they stand.
  for (const actor of ordered) {
    if (goals.has(actor.id)) continue;
    const seed = hashOf(actor.id);
    let goal: Goal | null = null;
    if (actor.state === "needs-you") {
      const spot = take(places.door, 0) ?? anywhere(seed);
      if (spot) goal = { spot, activity: "wave" };
    } else if (actor.state === "working") {
      const desk = deskOf(actor);
      if (desk && !atTable(actor) && !taken.has(desk.id)) {
        taken.add(desk.id);
        goal = { spot: desk, activity: "type" };
      } else {
        // Agents on one task stand together: they fill a table from its first free place.
        const spot = take(places.meeting, actor.huddle ? 0 : seed) ?? anywhere(seed);
        if (spot) goal = { spot, activity: "talk" };
      }
    } else {
      const spell = spellOf(actor);
      const rest = [...places.lounge, ...places.mingle];
      const spot = take(rest, hashOf(`${actor.id}:${spell}`)) ?? anywhere(seed);
      if (spot) goal = { spot, activity: "relax", spell };
    }
    if (goal) goals.set(actor.id, goal);
  }
  return goals;
}
