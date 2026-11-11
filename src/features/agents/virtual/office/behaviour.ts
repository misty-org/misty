import { hashOf } from "./look";
import type { OfficePlaces, Spot } from "./places";

/** Anyone in the office: one of the person's own agents, or a teammate's agent that is visiting. */
export interface Actor {
  id: string;
  name: string;
  /** For a visitor, the person it belongs to. */
  owner: string;
  guest: boolean;
  state: "working" | "needs-you" | "resting";
  doing: string;
  doingCode: string;
}

/** What a figure does once it has arrived. */
export type Activity = "type" | "talk" | "wave" | "relax";

export interface Goal {
  spot: Spot;
  activity: Activity;
}

/** Ticks between two changes of place for a resting figure. */
export const RESTLESS_TICKS = 6;

/**
 * Where everyone goes and what they do there. An agent that needs its person waits at the door and
 * waves; a working one types at its desk, or stands at the meeting table while it works with another
 * agent or has no desk; a resting one drifts between the lounge and the places to hang about, moving
 * on every few ticks. No two figures are sent to the same place.
 */
export function planGoals(
  actors: Actor[],
  places: OfficePlaces,
  desks: Map<string, string>,
  tick: number,
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
  for (const actor of ordered) {
    const seed = hashOf(actor.id);
    let goal: Goal | null = null;
    if (actor.state === "needs-you") {
      const spot = take(places.door, 0) ?? anywhere(seed);
      if (spot) goal = { spot, activity: "wave" };
    } else if (actor.state === "working") {
      const desk = actor.guest ? undefined : places.desks.get(desks.get(actor.id) ?? "");
      if (desk && actor.doingCode !== "agents") goal = { spot: desk, activity: "type" };
      else {
        const spot = take(places.meeting, seed) ?? anywhere(seed);
        if (spot) goal = { spot, activity: "talk" };
      }
    } else {
      const spell = Math.floor((tick + (seed % RESTLESS_TICKS)) / RESTLESS_TICKS);
      const rest = [...places.lounge, ...places.mingle];
      const spot = take(rest, hashOf(`${actor.id}:${spell}`)) ?? anywhere(seed);
      if (spot) goal = { spot, activity: "relax" };
    }
    if (goal) goals.set(actor.id, goal);
  }
  return goals;
}
