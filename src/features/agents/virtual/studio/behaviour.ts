import type { StudioEmote, StudioPlace } from "../studioOrders";
import type { Point } from "./grid";
import { hashOf } from "./look";
import type { StudioPlaces, Spot } from "./places";

/**
 * Anyone in the studio: one of the person's own agents, a teammate's agent that is visiting, or a
 * teammate themself, standing by their agents.
 */
export interface Actor {
  id: string;
  name: string;
  /** For a visitor, the person it belongs to. */
  owner: string;
  /** Anyone who isn't the person's own agent: a visiting agent or a member. */
  guest: boolean;
  /** A member stands by their agents and is talked to as a person; anyone else is an agent. */
  kind?: "agent" | "member";
  /** For a visiting agent or a member, the member's user id; for a visitor, its own id too. */
  ownerId?: string;
  agentId?: string;
  /** A member's picture, for their tag. */
  picture?: string;
  /** A member's whereabouts, in a few words ("In the Lab · Photosynthesis"). */
  where?: string;
  /** A member who just came in, who waves before settling. */
  arrived?: boolean;
  /** What a teammate's agent is changing that this agent is changing too, as a warning line. */
  clash?: string;
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
  /** Where it was told to go, by its person or by itself, while that still holds. */
  order?: StudioPlace;
  /** Something to act out where it stands, and when it was asked for. */
  emote?: { kind: StudioEmote; at: number };
}

/** What a figure does once it has arrived. */
export type Activity = "type" | "talk" | "wave" | "relax" | "play";

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

/** How many of the places nearest the person count as being with them. */
const NEAR_PERSON = 4;

/**
 * Where an order sends a figure, and what it does there; null when it has no order, or one this
 * room has nowhere for (no arcade, say), so it does what its work calls for instead.
 */
function orderedTo(
  actor: Actor,
  places: StudioPlaces,
  desk: Spot | undefined,
  person: Point | undefined,
): { activity: Activity; list: Spot[] } | null {
  if (!actor.order || actor.state === "needs-you") return null;
  const front = (kind: string) => places.byKind?.get(kind) ?? [];
  const pick = (activity: Activity, list: Spot[]) => (list.length ? { activity, list } : null);
  switch (actor.order) {
    case "desk":
      return desk ? { activity: "type", list: [desk] } : pick("talk", places.meeting);
    case "lounge":
      return pick("relax", places.lounge.length ? places.lounge : places.mingle);
    case "meeting":
      return pick("talk", places.meeting);
    case "door":
      return pick("relax", places.door);
    case "cooler":
    case "bookshelf":
      return pick("relax", front(actor.order));
    case "arcade":
      return pick("play", front("arcade"));
    case "person": {
      const at = person ?? places.door[0];
      if (!at) return null;
      const standing = [...places.mingle, ...places.meeting, ...places.door];
      const gap = (spot: Spot) => Math.hypot(spot.x - at.x, spot.z - at.z);
      standing.sort((a, b) => gap(a) - gap(b));
      return pick("relax", standing.slice(0, NEAR_PERSON * 3));
    }
  }
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
  /** Where the person's own figure stands while they walk the room. */
  person?: Point,
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
  const rank = { "needs-you": 0, working: 2, resting: 3 };
  // Someone sent somewhere goes before anyone who is only where their work puts them.
  const rankOf = (actor: Actor) =>
    actor.order && actor.state !== "needs-you" ? 1 : rank[actor.state];
  const ordered = [...actors].sort((a, b) => rankOf(a) - rankOf(b));
  const spellOf = (actor: Actor) =>
    Math.floor((tick + (hashOf(actor.id) % RESTLESS_TICKS)) / RESTLESS_TICKS);
  const deskOf = (actor: Actor) =>
    actor.guest ? undefined : places.desks.get(desks.get(actor.id) ?? "");
  const atTable = (actor: Actor) => actor.doingCode === "agents" || Boolean(actor.huddle);

  const orderOf = (actor: Actor) => orderedTo(actor, places, deskOf(actor), person);

  /** What the figure should be doing now, and the places that would do for it. */
  const wants = (actor: Actor): { activity: Activity; fits: (spot: Spot) => boolean } => {
    const order = orderOf(actor);
    if (order) {
      // Near the person means among the nearest few places, so it follows them round the room.
      const near = actor.order === "person" ? order.list.slice(0, NEAR_PERSON) : order.list;
      const ids = new Set(near.map((spot) => spot.id));
      return { activity: order.activity, fits: (spot) => ids.has(spot.id) };
    }
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

  // A resting figure that drifts to the arcade cabinet plays it rather than standing there.
  const arcade = new Set((places.byKind?.get("arcade") ?? []).map((spot) => spot.id));
  const resting = (goal: Goal): Activity =>
    goal.activity === "play" && arcade.has(goal.spot.id) ? "relax" : goal.activity;

  // First, everyone whose last place still fits keeps it.
  const byId = spotsById(places);
  for (const actor of ordered) {
    const last = previous.get(actor.id);
    if (!last) continue;
    const spot = byId.get(last.spot.id);
    const want = wants(actor);
    const was = want.activity === "relax" ? resting(last) : last.activity;
    if (!spot || taken.has(spot.id) || was !== want.activity || !want.fits(spot)) continue;
    const spell = spellOf(actor);
    if (want.activity === "relax" && last.spell !== spell) continue;
    taken.add(spot.id);
    goals.set(actor.id, { spot, activity: want.activity, spell });
  }

  // Then everyone else is found a place, in order of how much it matters where they stand.
  // Members come last, so they can stand by wherever their agents went.
  for (const actor of ordered) {
    if (goals.has(actor.id) || actor.kind === "member") continue;
    const seed = hashOf(actor.id);
    let goal: Goal | null = null;
    const order = orderOf(actor);
    if (order) {
      const nearest = actor.order === "person" || order.list.length === 1;
      const spot = take(order.list, nearest ? 0 : seed) ?? anywhere(seed);
      if (spot) goal = { spot, activity: order.list.includes(spot) ? order.activity : "relax" };
    } else if (actor.state === "needs-you") {
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

  for (const actor of ordered) {
    if (actor.kind !== "member" || goals.has(actor.id)) continue;
    const goal = memberGoal(actor, actors, goals, places, take, anywhere);
    if (goal) goals.set(actor.id, goal);
  }
  for (const [id, goal] of goals) {
    if (goal.activity === "relax" && arcade.has(goal.spot.id))
      goals.set(id, { ...goal, activity: "play" });
  }
  return goals;
}

/**
 * Where a member stands: at the meeting table while one of their agents works there, otherwise at
 * the free place to hang about nearest their agents; with no agents in the room, in the lounge.
 * A member who just came in waves.
 */
function memberGoal(
  member: Actor,
  actors: Actor[],
  goals: Map<string, Goal>,
  places: StudioPlaces,
  take: (list: Spot[], start: number) => Spot | null,
  anywhere: (start: number) => Spot | null,
): Goal | null {
  const seed = hashOf(member.id);
  const theirs = actors.filter(
    (actor) => actor.kind !== "member" && actor.guest && actor.ownerId === member.ownerId,
  );
  const working = theirs.some((actor) => actor.state === "working");
  const near = theirs.map((actor) => goals.get(actor.id)?.spot).find(Boolean);
  const activity: Activity = member.arrived ? "wave" : working ? "talk" : "relax";
  if (working) {
    const spot = take(places.meeting, 0) ?? anywhere(seed);
    return spot ? { spot, activity } : null;
  }
  if (near) {
    const standing = [...places.mingle, ...places.meeting].sort(
      (a, b) => Math.hypot(a.x - near.x, a.z - near.z) - Math.hypot(b.x - near.x, b.z - near.z),
    );
    const spot = take(standing, 0);
    if (spot) return { spot, activity };
  }
  const spot = take(places.lounge, seed) ?? anywhere(seed);
  return spot ? { spot, activity } : null;
}
