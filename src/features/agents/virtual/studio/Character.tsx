import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Vector3, type Group } from "three";
import type { Actor, Goal } from "./behaviour";
import type { Spot } from "./places";
import type { FigureLook } from "../studioLooks";
import { ME, gridAround, stepThrough, type Crowd } from "./crowd";
import { EMOTE_MS } from "../studioOrders";
import { emotePose } from "./emotes";
import { characterLook, hashOf } from "./look";
import { advanceWalker, createWalker, finishWalk, turnToward, type Walker } from "./motion";
import { Ball, Box, Capsule, FLOOR_MARK } from "./parts";
import { routeTo, type NavGrid } from "./pathfinding";

/** Scene units a figure walks in a second, and jogs when work has started or its person waits. */
const SPEED = 1.9;
const JOG = 3.4;
/** Seconds a cheer lasts once a run finishes. */
const CHEER_TIME = 1.8;
/** Height of the hips when standing; a sitting figure is set down so they rest on the seat. */
const HIP = 0.4;
/** Seconds to step into a seat and lower into it, and to get up and step back out. */
const SIT_TIME = 1.3;
const RISE_TIME = 1.0;
/** The share of sitting down spent stepping from the floor beside the seat onto it, turning to
 * face the way it sits; the rest is lowering into it. */
const STEP_SHARE = 0.4;
/** How near the floor beside its seat a figure must be to sit down: from further away it would
 * slide through whatever is between. */
const SEAT_REACH = 0.45;
/** Just over the top of a standing figure's head, where what it says is shown. */
const HEAD_TOP = 1.62;
/** Where the head turns on the body: the neck, over the shoulders. */
const NECK = 0.9;
/** How near the person must be for a figure to look at them, and how far its head turns and tips
 * before the rest of it would have to. */
const LOOK_NEAR = 4.5;
const LOOK_YAW = 1.15;
const LOOK_PITCH = 0.45;
/** How high the person's eyes are. */
const PERSON_EYES = 1.12;
/** Seconds held up, or walking without getting any nearer, before looking for another way round,
 * and before giving up and standing where it is; and how long it then waits to try again. Nobody
 * walks on the spot for good, and nobody is walked through. */
const HELD_REROUTE = 1;
const GIVE_UP = 2.5;
const RETRY_AFTER = 8;
/** How much nearer, in scene units, counts as getting somewhere. */
const PROGRESS = 0.25;
/** How near its place a held-up figure must be to just stop there. */
const NEAR_ENOUGH = 0.9;
/** Following the person: how far behind them it stays, how far they may get before it sets off
 * after them (or gets up out of its seat), and when it jogs to catch up. */
const FOLLOW_GAP = 1.15;
/** How near the person must be for a figure with their attention to stop and listen. */
const LISTEN_NEAR = 6;
const FOLLOW_FAR = 1.7;
const FOLLOW_JOG = 3.5;
/** Seconds between two looks at where the person has got to, and how far they must have moved
 * for the route after them to be worked out again. */
const FOLLOW_EVERY = 0.4;
const FOLLOW_MOVED = 0.5;

/** How a walk is going: seconds held up by someone in the way, and walking without getting
 * nearer; the nearest it has got to the end; whether it has tried another way; and seconds since
 * it gave up, or null while it hasn't. */
interface Hold {
  for: number;
  stalled: number;
  best: number;
  rerouted: boolean;
  gaveUp: number | null;
}
const freshHold = (): Hold => ({
  for: 0,
  stalled: 0,
  best: Infinity,
  rerouted: false,
  gaveUp: null,
});

/** An angle brought into the half turn either side of nothing. */
const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Slow at both ends, so a figure settles into a seat instead of snapping onto it. */
const ease = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const clampTo = (value: number, most: number) => Math.max(-most, Math.min(most, value));
/** Part of the way from one angle to another, the short way round. */
const mixAngle = (from: number, to: number, t: number) => from + wrapAngle(to - from) * t;

function Hair({ style, color, hat }: { style: 0 | 1 | 2 | 3; color: string; hat: string }) {
  const cap = (
    <mesh position={[0, 1.09, -0.012]} rotation={[-0.32, 0, 0]} castShadow>
      <sphereGeometry args={[0.252, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.52]} />
      <meshStandardMaterial color={style === 3 ? hat : color} roughness={0.9} />
    </mesh>
  );
  if (style === 1) {
    return (
      <>
        {cap}
        <Ball r={0.1} at={[0, 1.34, -0.1]} color={color} />
      </>
    );
  }
  if (style === 2) {
    return (
      <>
        {cap}
        <Box size={[0.44, 0.34, 0.16]} at={[0, 0.99, -0.15]} color={color} round={0.07} />
      </>
    );
  }
  if (style === 3) {
    return (
      <>
        {cap}
        <Ball r={0.065} at={[0, 1.36, -0.03]} color="#f4f1de" />
        <Box
          size={[0.4, 0.1, 0.12]}
          at={[0, 0.94, -0.17]}
          color={color}
          round={0.04}
          shadow={false}
        />
      </>
    );
  }
  return cap;
}

/** Round glasses: two dark frames and the bridge between them. */
function Glasses() {
  return (
    <>
      {[0.088, -0.088].map((x) => (
        <Box
          key={x}
          size={[0.11, 0.075, 0.018]}
          at={[x, 1.09, 0.228]}
          color="#1f1f24"
          round={0.03}
          shadow={false}
        />
      ))}
      <Box size={[0.07, 0.016, 0.016]} at={[0, 1.1, 0.232]} color="#1f1f24" shadow={false} />
    </>
  );
}

/** Headphones: a band over the head and a cup at each ear. */
function Headphones() {
  return (
    <>
      <Box size={[0.5, 0.045, 0.08]} at={[0, 1.335, -0.01]} color="#2a2d34" round={0.02} />
      {[0.255, -0.255].map((x) => (
        <group key={x}>
          <Box
            size={[0.04, 0.24, 0.07]}
            at={[x, 1.2, -0.01]}
            color="#2a2d34"
            round={0.015}
            shadow={false}
          />
          <Ball r={0.085} at={[x, 1.07, 0]} scale={[0.55, 1, 1]} color="#3b3f48" />
        </group>
      ))}
    </>
  );
}

/** A cap in the figure's shirt colour, peak to the front. */
function Cap({ color }: { color: string }) {
  return (
    <>
      <mesh position={[0, 1.1, -0.005]} rotation={[-0.2, 0, 0]} castShadow>
        <sphereGeometry args={[0.258, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
        <meshStandardMaterial color={color} roughness={0.85} />
      </mesh>
      <Box size={[0.3, 0.025, 0.2]} at={[0, 1.17, 0.24]} color={color} round={0.01} />
    </>
  );
}

/** The bobbing marks above a figure's head: an exclamation mark when it needs its person, and the
 * green diamond over whichever one is picked. */
function Marks({
  needsYou,
  selected,
  still,
}: {
  needsYou: boolean;
  selected: boolean;
  still: boolean;
}) {
  const bang = useRef<Group>(null);
  const gem = useRef<Group>(null);
  useFrame(({ clock }) => {
    const time = still ? 0 : clock.elapsedTime;
    if (bang.current) bang.current.position.y = 1.72 + Math.abs(Math.sin(time * 3.2)) * 0.1;
    if (gem.current) {
      gem.current.position.y = (needsYou ? 2.22 : 1.84) + Math.sin(time * 2.2) * 0.04;
      gem.current.rotation.y = time * 1.6;
    }
  });
  return (
    <>
      {needsYou ? (
        <group ref={bang} position={[0, 1.72, 0]}>
          <Ball r={0.17} at={[0, 0.1, 0]} color="#ffb703" />
          <Box
            size={[0.06, 0.15, 0.06]}
            at={[0, 0.14, 0.13]}
            color="#3a2a00"
            round={0.02}
            shadow={false}
          />
          <Box
            size={[0.06, 0.06, 0.06]}
            at={[0, 0.02, 0.13]}
            color="#3a2a00"
            round={0.02}
            shadow={false}
          />
          <Box
            size={[0.06, 0.15, 0.06]}
            at={[0, 0.14, -0.13]}
            color="#3a2a00"
            round={0.02}
            shadow={false}
          />
          <Box
            size={[0.06, 0.06, 0.06]}
            at={[0, 0.02, -0.13]}
            color="#3a2a00"
            round={0.02}
            shadow={false}
          />
        </group>
      ) : null}
      {selected ? (
        <>
          <group ref={gem} position={[0, 1.84, 0]}>
            <mesh scale={[1, 1.7, 1]}>
              <octahedronGeometry args={[0.1, 0]} />
              <meshStandardMaterial
                color="#5fe36b"
                emissive="#2fbf4a"
                emissiveIntensity={0.9}
                flatShading
              />
            </mesh>
          </group>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_MARK, 0]}>
            <ringGeometry args={[0.36, 0.45, 40]} />
            <meshBasicMaterial color="#5fe36b" transparent opacity={0.9} />
          </mesh>
        </>
      ) : null}
    </>
  );
}

/**
 * One agent as a little figure. It walks the route to wherever its goal is, sits down when that is
 * a seat, and then does what the goal says: types, talks, waves at the camera or just rests.
 * Everything it does is read from the goal; the figure decides nothing itself.
 */
export function Character(props: {
  actor: Actor;
  goal: Goal;
  grid: NavGrid;
  shirt: string;
  selected: boolean;
  /** No walking or swaying: the figure is simply put where it belongs. */
  still: boolean;
  /** Build mode: figures stay out of the way of the furniture being moved. */
  quiet: boolean;
  /** The person is talking to it: it stops where it is and turns to them. */
  listening: boolean;
  /** Everyone on the floor, which it keeps out of the way of and keeps its own place in. */
  crowd: Crowd;
  /** Where each figure's name goes, kept current for the tags drawn over the scene. */
  anchors: Map<string, Vector3>;
  /** How its person dressed it up, over the look worked out from its id. */
  figure?: FigureLook;
  onPick(id: string): void;
}) {
  const { actor, goal, grid, still } = props;
  const figure = props.figure;
  const look = useMemo(() => {
    const own = characterLook(actor.id);
    return {
      ...own,
      skin: figure?.skin ?? own.skin,
      hair: figure?.hair ?? own.hair,
      hairStyle: figure?.hairStyle ?? own.hairStyle,
      trousers: figure?.trousers ?? own.trousers,
    };
  }, [actor.id, figure]);
  const shirt = figure?.shirt ?? props.shirt;
  const walker = useRef<Walker | null>(null);
  walker.current ??= createWalker(goal.spot.via ?? goal.spot, goal.spot.yaw);
  // How far into its seat the figure is, from standing on the floor beside it to sat down, and
  // which seat that is: getting up finishes in the old seat before the walk to the next place.
  const seated = useRef(goal.spot.sit ? 1 : 0);
  const seat = useRef<Spot | null>(goal.spot.sit ? goal.spot : null);
  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
  /** Everything above the hips, which leans and sways on them. */
  const torso = useRef<Group>(null);
  const head = useRef<Group>(null);
  /** How much it is looking at the person, eased in and out so the head never snaps round. */
  const gaze = useRef(0);
  /** Whether it was last getting up, rather than sitting down, and the way it steps out. */
  const rising = useRef<{ was: number; out: number | null }>({ was: 0, out: null });
  const thighs = [useRef<Group>(null), useRef<Group>(null)];
  const shins = [useRef<Group>(null), useRef<Group>(null)];
  const arms = [useRef<Group>(null), useRef<Group>(null)];
  const phase = useMemo(() => (actor.id.length * 1.7) % 6, [actor.id]);
  // A run finishing while the room is watched is cheered once; one that was done before it opened
  // isn't, since nobody saw it end.
  const outcome = actor.outcome ?? "";
  const lastOutcome = useRef(outcome);
  const cheer = useRef<{ pending: boolean; from: number }>({ pending: false, from: -1 });
  useEffect(() => {
    if (outcome === "done" && lastOutcome.current !== "done") cheer.current.pending = true;
    lastOutcome.current = outcome;
  }, [outcome]);

  /** How long it has been held up by someone in its way, and walked without getting nearer;
   * whether it has looked for another way since; and how long ago it gave up, if it has. */
  const held = useRef<Hold>(freshHold());
  /** Where the person was when the route after them was last worked out, and when. */
  const chase = useRef<{ x: number; z: number; at: number } | null>(null);

  useEffect(() => {
    const self = walker.current;
    if (!self) return;
    // Following the person, it keeps after them; it goes to its new place once that ends.
    const withPerson = actor.order === "person";
    if (withPerson && props.crowd.has(ME) && !still) return;
    // A seat is walked up to, not into: the figure stops on the floor beside it and sits from there.
    const stop = goal.spot.via ?? goal.spot;
    self.path = routeTo(grid, self, stop, stop);
    self.moving = true;
    held.current = freshHold();
    if (still) {
      finishWalk(self);
      self.yaw = goal.spot.yaw;
      seated.current = goal.spot.sit ? 1 : 0;
      seat.current = goal.spot.sit ? goal.spot : null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new place re-routes; talking is read as it stands
  }, [grid, goal.spot, still]);

  const { anchors, crowd } = props;
  // Done talking, or no longer called over: back to where its work puts it, from wherever
  // following the person took it.
  const withPerson = props.listening || actor.order === "person";
  const wasWithPerson = useRef(withPerson);
  useEffect(() => {
    const self = walker.current;
    const was = wasWithPerson.current;
    wasWithPerson.current = withPerson;
    chase.current = null;
    if (!self || !was || withPerson) return;
    const stop = goal.spot.via ?? goal.spot;
    self.path = routeTo(grid, self, stop, stop);
    self.moving = true;
    held.current = freshHold();
    if (still) finishWalk(self);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the end of a talk re-routes
  }, [withPerson]);
  useEffect(() => () => void crowd.delete(actor.id), [crowd, actor.id]);
  useEffect(() => {
    anchors.set(actor.id, new Vector3(goal.spot.x, 0, goal.spot.z));
    anchors.set(`head:${actor.id}`, new Vector3(goal.spot.x, HEAD_TOP, goal.spot.z));
    return () => {
      anchors.delete(actor.id);
      anchors.delete(`head:${actor.id}`);
    };
    // The anchor only has to exist; the frame loop keeps it where the figure is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchors, actor.id]);

  /**
   * One step along the route among everyone else: round whoever is in the way, never into them.
   * Held up, or getting no nearer, for long, it stops if it is nearly there, else looks for
   * another way round them, and failing that gives up and stands where it is for a while.
   */
  const walkAmong = (self: Walker, step: number, speed?: number) => {
    const from = { x: self.x, z: self.z };
    const path = self.path.slice();
    const stride = self.stride;
    const hurry = goal.activity === "type" || goal.activity === "wave";
    advanceWalker(self, step, speed ?? (hurry ? JOG : SPEED));
    const wait = held.current;
    const { at, blocked } = stepThrough(actor.id, from, self, crowd, grid);
    const end = path[path.length - 1];
    if (blocked) {
      [self.x, self.z, self.path, self.stride, self.moving] = [from.x, from.z, path, stride, true];
      wait.for += step;
    } else {
      [self.x, self.z] = [at.x, at.z];
      wait.for = 0;
      // Stepped aside at the very end of the route: it still has to get to its place.
      if (!self.path.length && end && Math.hypot(end.x - at.x, end.z - at.z) > 0.05) {
        self.path = [end];
        self.moving = true;
      }
    }
    if (!end) return;
    const left = Math.hypot(end.x - self.x, end.z - self.z);
    if (left < wait.best - PROGRESS) [wait.best, wait.stalled] = [left, 0];
    else wait.stalled += step;
    const stuck = Math.max(wait.for, wait.stalled);
    if (stuck < HELD_REROUTE) return;
    if (left < NEAR_ENOUGH) {
      // Close enough to count as there.
      [self.path, self.moving] = [[], false];
      held.current = freshHold();
    } else if (!wait.rerouted) {
      const around = gridAround(grid, actor.id, crowd, [self, end]);
      self.path = routeTo(around, self, end, end);
      held.current = { ...freshHold(), rerouted: true };
    } else if (stuck >= GIVE_UP) {
      [self.path, self.moving] = [[], false];
      held.current = { ...freshHold(), gaveUp: 0 };
    }
  };

  useFrame(({ clock, camera }, delta) => {
    const self = walker.current;
    if (!self || !root.current || !body.current) return;
    const step = Math.min(delta, 0.1);
    const time = still ? 0 : clock.elapsedTime + phase;
    // Get up before setting off; once arrived beside the seat, step onto it and lower into it.
    // A figure that gave up, or stopped, short of its seat doesn't sit in it from across the room.
    const entry = goal.spot.via ?? goal.spot;
    const besideSeat = Math.hypot(entry.x - self.x, entry.z - self.z) < SEAT_REACH;
    const here =
      !self.moving &&
      goal.spot.sit &&
      held.current.gaveUp === null &&
      (besideSeat || seat.current === goal.spot)
        ? goal.spot
        : null;
    // With the person's attention it stops where it is and turns to them, while they're near; it
    // never trails after them for it. Walked away from, it gets on with its work, still listening
    // in the chat.
    const near = crowd.get(ME);
    const listening =
      props.listening && (!near || Math.hypot(near.x - self.x, near.z - self.z) < LISTEN_NEAR);
    // Told to come to the person, it follows their figure, each at its own distance, so the team
    // stands round them, until it is sent back to work.
    const summoned = actor.order === "person" && !listening;
    const me = summoned && !still ? crowd.get(ME) : undefined;
    const gap = me ? Math.hypot(me.x - self.x, me.z - self.z) : 0;
    const keep = summoned ? FOLLOW_GAP + 0.35 + (hashOf(actor.id) % 5) * 0.2 : FOLLOW_GAP;
    const following = Boolean(me) && (self.moving || gap > keep + FOLLOW_FAR - FOLLOW_GAP);
    if (!still) {
      if (me && following) {
        if (seat.current) {
          // Up out of its seat first.
          seated.current = Math.max(0, seated.current - step / RISE_TIME);
          if (seated.current === 0) seat.current = null;
        } else if (gap <= keep) {
          [self.path, self.moving] = [[], false];
          held.current = freshHold();
          chase.current = null;
        } else {
          const now = clock.elapsedTime;
          const last = chase.current;
          const moved = !last || Math.hypot(me.x - last.x, me.z - last.z) > FOLLOW_MOVED;
          // Given up on getting nearer (the others are round them already), it stays where it
          // is until the person moves on.
          if (held.current.gaveUp === null || moved) {
            if (moved || (self.moving && last && now - last.at > FOLLOW_EVERY)) {
              // A step short of them, on their side of where it stands.
              const toward = { x: (self.x - me.x) / gap, z: (self.z - me.z) / gap };
              const target = { x: me.x + toward.x * keep, z: me.z + toward.z * keep };
              self.path = routeTo(grid, self, target, target);
              self.moving = self.path.length > 0;
              chase.current = { x: me.x, z: me.z, at: now };
              if (moved) held.current = freshHold();
            }
            if (self.moving) walkAmong(self, step, gap > 4 ? FOLLOW_JOG : SPEED * 1.2);
          }
        }
      } else if (me) {
        // With the person and near enough: it stands where it is.
        if (here && seat.current === here)
          seated.current = Math.min(1, seated.current + step / SIT_TIME);
      } else if (listening) {
        // It stops where it is to listen, only finishing sitting down if it was halfway there.
        if (here && seat.current === here)
          seated.current = Math.min(1, seated.current + step / SIT_TIME);
      } else if (seat.current && seat.current !== here) {
        seated.current = Math.max(0, seated.current - step / RISE_TIME);
        if (seated.current === 0) seat.current = null;
      } else if (self.moving) {
        walkAmong(self, step);
      } else if (held.current.gaveUp !== null) {
        // Gave up short of its place: after a while it tries again.
        held.current.gaveUp += step;
        if (held.current.gaveUp >= RETRY_AFTER) {
          const stop = goal.spot.via ?? goal.spot;
          self.path = routeTo(grid, self, stop, stop);
          self.moving = true;
          held.current = freshHold();
        }
      } else if (goal.spot.sit && !here && !seat.current) {
        // Stopped short of its seat with no way nearer: it stands where it is and tries again.
        held.current = { ...freshHold(), gaveUp: 0 };
      } else if (here) {
        seat.current = here;
        seated.current = Math.min(1, seated.current + step / SIT_TIME);
      }
    }
    const tagging = following && self.moving;
    const arrived =
      ((listening || Boolean(me)) && !tagging) ||
      (!self.moving && !(seat.current && seat.current !== here));
    // The person: their own figure while they walk the room, otherwise the camera they look from.
    const person = crowd.get(ME) ?? camera.position;
    const toPerson = Math.atan2(person.x - self.x, person.z - self.z);
    const into = seat.current;
    if (arrived && !into) {
      // A figure that is waving, or that the person is talking to, turns to face them.
      const facePerson = goal.activity === "wave" || listening || Boolean(me);
      const want = facePerson ? toPerson : goal.spot.yaw;
      self.yaw = still ? want : turnToward(self.yaw, want, step * 7);
    }
    // Sitting down is two moves: a step from the floor beside the seat onto it, turning to face
    // the way it sits, then lowering into it, hips back and knees bent. Getting up is the same
    // backwards, stepping out the way it came.
    const progress = into ? seated.current : 0;
    const stepIn = clamp01(progress / STEP_SHARE);
    const sit = ease(clamp01((progress - STEP_SHARE) / (1 - STEP_SHARE)));
    const settle = ease(stepIn);
    const getting = rising.current;
    if (into && progress < getting.was && getting.out === null)
      getting.out = Math.atan2(self.x - into.x, self.z - into.z);
    if (!into || progress >= 1) {
      // Out of the seat: it walks off facing the way it stepped out.
      if (!into && getting.out !== null) self.yaw = getting.out;
      getting.out = null;
    }
    getting.was = progress;
    const yaw = !into
      ? self.yaw
      : getting.out !== null
        ? mixAngle(getting.out, into.yaw, ease(clamp01(stepIn * 1.25)))
        : mixAngle(self.yaw, into.yaw, ease(clamp01(stepIn * 1.25)));
    const x = into ? self.x + (into.x - self.x) * settle : self.x;
    const z = into ? self.z + (into.z - self.z) * settle : self.z;
    // The legs step while it moves onto the seat, and walk while it walks.
    const stepping = Boolean(into) && stepIn > 0 && stepIn < 1 && sit === 0;
    const walking = self.moving && (!(listening || me) || tagging) && progress === 0;
    const reach = into ? Math.hypot(into.x - self.x, into.z - self.z) : 0;
    const swing = walking
      ? Math.sin(self.stride * 7)
      : stepping
        ? Math.sin(settle * reach * 7) * Math.sin(Math.PI * stepIn)
        : 0;
    const rise = into ? sit * (into.seatY + 0.075 - HIP) : 0;
    // Level as it walks: the body glides, only the legs and arms swing.
    root.current.position.set(x, rise, z);
    root.current.rotation.y = yaw;
    anchors.get(actor.id)?.set(x, -0.1, z);
    crowd.set(actor.id, {
      x,
      z,
      moving: self.moving && (!(listening || me) || tagging),
      seated: sit > 0.5,
    });
    // Over the head, and over the mark that bobs there when it needs its person.
    const over = actor.state === "needs-you" ? 0.55 : props.selected ? 0.4 : 0;
    anchors.get(`head:${actor.id}`)?.set(x, HEAD_TOP + rise + over, z);
    // Halfway down it leans forward over its knees, as anyone does to keep their balance, and
    // straightens once it is in the seat.
    const lean = Math.sin(Math.PI * sit) * 0.38;

    // Short of its place it just stands about, rather than typing or playing at nothing.
    const short = held.current.gaveUp !== null;
    const activity =
      listening && !tagging
        ? "listen"
        : (me || short) && !tagging
          ? "relax"
          : arrived && (!into || progress >= 1)
            ? goal.activity
            : "walk";
    // Something it was asked to act out, for a moment, wherever it stands.
    const emote = actor.emote && !walking ? actor.emote : null;
    const emoteAge = emote ? (Date.now() - emote.at) / 1000 : Infinity;
    const acting = !still && emote && emoteAge < EMOTE_MS / 1000 ? emote.kind : null;
    const breath = Math.sin(time * 1.8) * 0.012;
    if (cheer.current.pending) {
      cheer.current = { pending: false, from: clock.elapsedTime };
    }
    const cheerAge = cheer.current.from < 0 ? Infinity : clock.elapsedTime - cheer.current.from;
    const cheering = !still && cheerAge < CHEER_TIME && progress === 0;
    // A failed run leaves the figure slumped where it rests until the person looks.
    const slumped = outcome === "failed" && activity !== "walk";
    // A cheer is two little hops with the arms up.
    const hop = cheering ? Math.abs(Math.sin((cheerAge / CHEER_TIME) * Math.PI * 2)) * 0.22 : 0;
    const bounce =
      acting === "dance" && !sit
        ? Math.abs(Math.sin(emoteAge * 6)) * 0.08
        : acting === "cheer" && !sit
          ? Math.abs(Math.sin(emoteAge * 5)) * 0.18
          : 0;
    // Poses ease into each other instead of snapping: quickly while walking, so the swing keeps
    // its stride, gently otherwise.
    const blend = (rate: number) => (still ? 1 : 1 - Math.exp(-rate * step));
    const limbs = blend(walking || stepping ? 22 : 9);
    const settleIn = blend(8);
    body.current.position.y = (activity === "walk" ? 0 : breath) + hop + bounce;
    if (torso.current) {
      const tilt =
        lean +
        (activity === "type" ? 0.1 * sit : walking ? 0.06 : activity === "play" ? 0.08 : 0) +
        (slumped ? 0.16 : 0);
      const sway =
        acting === "dance"
          ? Math.sin(emoteAge * 6) * 0.14
          : activity === "relax" && !sit
            ? Math.sin(time * 0.9) * 0.03
            : 0;
      torso.current.rotation.x += (tilt - torso.current.rotation.x) * (sit > 0 ? 1 : settleIn);
      torso.current.rotation.z += (sway - torso.current.rotation.z) * settleIn;
      // The shoulders turn against the hips as it walks.
      const twist = walking ? Math.sin(self.stride * 7) * 0.08 : 0;
      torso.current.rotation.y += (twist - torso.current.rotation.y) * limbs;
    }
    thighs.forEach((thigh, side) => {
      const sign = side ? -1 : 1;
      if (thigh.current) thigh.current.rotation.x = -sit * (Math.PI / 2) + swing * 0.7 * sign;
      const shin = shins[side]?.current;
      // The knee bends as the leg swings through, and fully once it sits.
      if (shin)
        shin.rotation.x =
          sit * (Math.PI / 2) + (walking || stepping ? Math.max(0, -swing * sign) * 0.8 : 0);
    });
    arms.forEach((arm, side) => {
      if (!arm.current) return;
      const sign = side ? -1 : 1;
      let lift = -swing * 0.6 * sign;
      let out = 0.06 * sign;
      if (activity === "type") lift = -1.05 + Math.sin(time * 14 + side * 2.1) * 0.07;
      if (activity === "talk") lift = side ? -0.25 : -0.9 + Math.sin(time * 2.6) * 0.3;
      if (activity === "relax") lift = sit ? -0.55 : Math.sin(time * 0.9 + side) * 0.05;
      // Hands still while it listens: in its lap when sitting, at its sides when standing.
      if (activity === "listen") lift = sit ? -0.55 : 0.03;
      // At the arcade cabinet's controls, one hand on the stick and one on the buttons.
      if (activity === "play") lift = -1.15 + Math.sin(time * (side ? 11 : 7) + side) * 0.08;
      if (activity === "wave" && side === 0) {
        lift = 0;
        out = 2.55 + Math.sin(time * 9) * 0.32;
      }
      // The other hand holds out what it needs the person to look at.
      if (activity === "wave" && side === 1) lift = -1.2;
      if (slumped && activity !== "type") lift = sit ? -0.3 : 0.08;
      // Lowering into a seat, the hands come forward for balance.
      if (into && progress < 1) lift += -0.45 * Math.sin(Math.PI * sit);
      if (cheering) {
        lift = 0;
        out = sign * (2.7 + Math.sin(time * 12) * 0.15);
      }
      if (acting) [lift, out] = emotePose(acting, side, emoteAge, lift, out);
      arm.current.rotation.x += (lift - arm.current.rotation.x) * limbs;
      arm.current.rotation.z += (out - arm.current.rotation.z) * limbs;
    });
    if (head.current) {
      let turn = activity === "relax" ? Math.sin(time * 0.45) * 0.45 : 0;
      let nod =
        activity === "type"
          ? 0.12 + Math.sin(time * 0.7) * 0.03
          : activity === "talk"
            ? Math.sin(time * 2.6) * 0.06
            : 0;
      let tip = activity === "wave" ? Math.sin(time * 4.5) * 0.06 : 0;
      if (activity === "listen") {
        nod = Math.sin(time * 1.6) * 0.04;
        tip = 0.07;
      }
      // Near the person, it looks at them: the head turns and tips to their eyes, as far as a neck
      // goes, and back to what it was doing once they walk on or get behind it. Busy at a desk it
      // only glances.
      const mine = crowd.get(ME);
      const away = mine ? Math.hypot(mine.x - x, mine.z - z) : Infinity;
      const toward = mine ? wrapAngle(Math.atan2(mine.x - x, mine.z - z) - yaw) : 0;
      const sees =
        !still && mine && away < LOOK_NEAR && Math.abs(toward) < LOOK_YAW + 0.6 && !acting;
      const want = sees
        ? (listening ? 1 : activity === "type" || activity === "play" ? 0.7 : 0.9) *
          clamp01(LOOK_NEAR - away)
        : 0;
      gaze.current += (want - gaze.current) * blend(4);
      if (gaze.current > 0.001) {
        const eyes = rise + body.current.position.y + NECK + 0.18;
        const up = Math.atan2(PERSON_EYES - eyes, Math.max(0.3, away));
        turn += (clampTo(toward, LOOK_YAW) - turn) * gaze.current;
        nod += (clampTo(-up, LOOK_PITCH) - nod) * gaze.current;
        tip *= 1 - gaze.current;
      }
      if (slumped && !acting) nod = 0.42;
      if (acting === "think") [nod, tip] = [-0.1, 0.16];
      if (acting === "cheer" || acting === "dance") nod = -0.2;
      if (cheering) nod = -0.25;
      const headEase = blend(10);
      head.current.rotation.y += (turn - head.current.rotation.y) * headEase;
      head.current.rotation.x += (nod - head.current.rotation.x) * headEase;
      head.current.rotation.z += (tip - head.current.rotation.z) * headEase;
    }
  });

  const pick = (event: ThreeEvent<MouseEvent>) => {
    if (props.quiet) return;
    event.stopPropagation();
    props.onPick(actor.id);
  };
  const start = walker.current;
  return (
    <group ref={root} position={[start.x, 0, start.z]} rotation={[0, start.yaw, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_MARK, 0]}>
        <circleGeometry args={[0.3, 24]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.16} depthWrite={false} />
      </mesh>
      <group ref={body}>
        {[0.105, -0.105].map((x, side) => (
          <group key={x} ref={thighs[side]} position={[x, HIP, 0]}>
            <Capsule r={0.078} h={0.27} at={[0, -0.1, 0]} color={look.trousers} />
            <group ref={shins[side]} position={[0, -0.2, 0]}>
              <Capsule r={0.068} h={0.22} at={[0, -0.08, 0]} color={look.trousers} shadow={false} />
              <Box
                size={[0.14, 0.075, 0.22]}
                at={[0, -0.162, 0.04]}
                color="#f4f1ea"
                round={0.03}
                shadow={false}
              />
            </group>
          </group>
        ))}
        <group ref={torso} position={[0, HIP, 0]}>
          <group position={[0, -HIP, 0]}>
            <Box
              size={[0.38, 0.16, 0.25]}
              at={[0, 0.44, 0]}
              color={look.trousers}
              round={0.06}
              shadow={false}
            />
            <Box size={[0.43, 0.42, 0.28]} at={[0, 0.68, 0]} color={shirt} round={0.11} />
            {[0.265, -0.265].map((x, side) => (
              <group key={x} ref={arms[side]} position={[x, 0.82, 0]}>
                <Capsule r={0.062} h={0.3} at={[0, -0.13, 0]} color={shirt} shadow={false} />
                <Ball r={0.062} at={[0, -0.31, 0]} color={look.skin} shadow={false} />
                {side === 1 && actor.state === "needs-you" ? (
                  // The paperwork it brings its person: a sheet with a few lines on it.
                  <group position={[0, -0.37, 0.06]} rotation={[Math.PI / 2, 0, 0]}>
                    <Box
                      size={[0.2, 0.26, 0.012]}
                      at={[0, -0.1, 0]}
                      color="#fbfaf6"
                      shadow={false}
                    />
                    {[-0.02, -0.07, -0.12].map((y) => (
                      <Box
                        key={y}
                        size={[0.13, 0.014, 0.014]}
                        at={[0, y, 0.004]}
                        color="#9aa0aa"
                        shadow={false}
                      />
                    ))}
                  </group>
                ) : null}
              </group>
            ))}
            <group ref={head} position={[0, NECK, 0]}>
              <group position={[0, -NECK, 0]}>
                <Ball r={0.24} at={[0, 1.08, 0]} scale={[1, 0.96, 0.96]} color={look.skin} />
                <Ball r={0.027} at={[0.085, 1.09, 0.212]} color="#2a2420" shadow={false} />
                <Ball r={0.027} at={[-0.085, 1.09, 0.212]} color="#2a2420" shadow={false} />
                <Box
                  size={[0.07, 0.018, 0.02]}
                  at={[0, 1.0, 0.222]}
                  color="#a2553f"
                  round={0.008}
                  shadow={false}
                />
                {figure?.accessory === "cap" ? (
                  <Cap color={shirt} />
                ) : (
                  <Hair style={look.hairStyle} color={look.hair} hat={look.trousers} />
                )}
                {figure?.accessory === "glasses" ? <Glasses /> : null}
                {figure?.accessory === "headphones" ? <Headphones /> : null}
              </group>
            </group>
            {actor.guest && actor.kind !== "member" ? (
              <Box
                size={[0.1, 0.13, 0.02]}
                at={[0.1, 0.7, 0.145]}
                color="#f4f1ea"
                round={0.008}
                shadow={false}
              />
            ) : null}
          </group>
        </group>
      </group>
      {/* A generous target, so a figure is easy to pick even from far away. */}
      <mesh
        position={[0, 0.7, 0]}
        onClick={pick}
        onPointerOver={() => !props.quiet && (document.body.style.cursor = "pointer")}
        onPointerOut={() => (document.body.style.cursor = "")}
      >
        <cylinderGeometry args={[0.36, 0.36, 1.45, 10]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <Marks needsYou={actor.state === "needs-you"} selected={props.selected} still={still} />
    </group>
  );
}
