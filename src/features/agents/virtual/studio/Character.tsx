import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Vector3, type Group } from "three";
import type { Actor, Goal } from "./behaviour";
import type { Spot } from "./places";
import type { FigureLook } from "../studioLooks";
import { characterLook } from "./look";
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
/** Seconds to lower into a seat, and to get up out of one. */
const SIT_TIME = 0.9;
/** Just over the top of a standing figure's head, where what it says is shown. */
const HEAD_TOP = 1.62;
const RISE_TIME = 0.6;

/** Slow at both ends, so a figure settles into a seat instead of snapping onto it. */
const ease = (t: number) => t * t * (3 - 2 * t);

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
  const head = useRef<Group>(null);
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

  useEffect(() => {
    const self = walker.current;
    if (!self) return;
    // A seat is walked up to, not into: the figure stops on the floor beside it and sits from there.
    const stop = goal.spot.via ?? goal.spot;
    self.path = routeTo(grid, self, stop, stop);
    self.moving = true;
    if (still) {
      finishWalk(self);
      self.yaw = goal.spot.yaw;
      seated.current = goal.spot.sit ? 1 : 0;
      seat.current = goal.spot.sit ? goal.spot : null;
    }
  }, [grid, goal.spot, still]);

  const { anchors } = props;
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

  useFrame(({ clock, camera }, delta) => {
    const self = walker.current;
    if (!self || !root.current || !body.current) return;
    const step = Math.min(delta, 0.1);
    const time = still ? 0 : clock.elapsedTime + phase;
    // Get up before setting off; once arrived, turn to the seat and only then lower into it.
    const here = !self.moving && goal.spot.sit ? goal.spot : null;
    if (!still) {
      if (seat.current && seat.current !== here) {
        seated.current = Math.max(0, seated.current - step / RISE_TIME);
        if (seated.current === 0) seat.current = null;
      } else if (self.moving) {
        const hurry = goal.activity === "type" || goal.activity === "wave";
        advanceWalker(self, step, hurry ? JOG : SPEED);
      } else if (here) {
        const turned = Math.abs(Math.sin((self.yaw - here.yaw) / 2)) < 0.03;
        if (turned || seat.current) {
          seat.current = here;
          seated.current = Math.min(1, seated.current + step / SIT_TIME);
        }
      }
    }
    const arrived = !self.moving && !(seat.current && seat.current !== here);
    if (arrived) {
      const toCamera = Math.atan2(camera.position.x - self.x, camera.position.z - self.z);
      // A figure that is waving, or that the person picked to talk to, turns to face them.
      const facePerson = goal.activity === "wave" || (props.selected && !goal.spot.sit);
      const want = facePerson ? toCamera : goal.spot.yaw;
      self.yaw = still ? want : turnToward(self.yaw, want, step * 7);
    }
    const into = seat.current;
    const sit = into ? ease(seated.current) : 0;
    const walking = self.moving && sit === 0;
    const swing = walking ? Math.sin(self.stride * 7) : 0;
    // Sitting carries the figure from the floor beside the seat onto it, hips first.
    const x = into ? self.x + (into.x - self.x) * sit : self.x;
    const z = into ? self.z + (into.z - self.z) * sit : self.z;
    const rise = into ? sit * (into.seatY + 0.075 - HIP) : 0;
    root.current.position.set(
      x,
      rise + (walking ? Math.abs(Math.cos(self.stride * 7)) * 0.035 : 0),
      z,
    );
    root.current.rotation.y = into && sit > 0 ? into.yaw : self.yaw;
    anchors.get(actor.id)?.set(x, -0.1, z);
    // Over the head, and over the mark that bobs there when it needs its person.
    const over = actor.state === "needs-you" ? 0.55 : props.selected ? 0.4 : 0;
    anchors.get(`head:${actor.id}`)?.set(x, HEAD_TOP + rise + over, z);
    // Halfway down the body leans forward, as anyone does to keep their balance over a chair.
    const lean = into ? Math.sin(Math.PI * seated.current) * 0.34 : 0;

    const activity = arrived ? goal.activity : "walk";
    const breath = Math.sin(time * 1.8) * 0.012;
    if (cheer.current.pending) {
      cheer.current = { pending: false, from: clock.elapsedTime };
    }
    const cheerAge = cheer.current.from < 0 ? Infinity : clock.elapsedTime - cheer.current.from;
    const cheering = !still && cheerAge < CHEER_TIME && sit === 0;
    // A failed run leaves the figure slumped where it rests until the person looks.
    const slumped = outcome === "failed" && activity !== "walk";
    // A cheer is two little hops with the arms up.
    const hop = cheering ? Math.abs(Math.sin((cheerAge / CHEER_TIME) * Math.PI * 2)) * 0.22 : 0;
    body.current.position.y = (activity === "walk" ? 0 : breath) + hop;
    body.current.rotation.x =
      lean + (activity === "type" ? 0.1 * sit : walking ? 0.06 : 0) + (slumped ? 0.16 : 0);
    body.current.rotation.z = activity === "relax" && !sit ? Math.sin(time * 0.9) * 0.03 : 0;
    thighs.forEach((thigh, side) => {
      const sign = side ? -1 : 1;
      if (thigh.current) thigh.current.rotation.x = -sit * (Math.PI / 2) + swing * 0.7 * sign;
      const shin = shins[side]?.current;
      if (shin)
        shin.rotation.x = sit * (Math.PI / 2) + (walking ? Math.max(0, -swing * sign) * 0.8 : 0);
    });
    arms.forEach((arm, side) => {
      if (!arm.current) return;
      const sign = side ? -1 : 1;
      let lift = -swing * 0.6 * sign;
      let out = 0.06 * sign;
      if (activity === "type") lift = -1.05 + Math.sin(time * 14 + side * 2.1) * 0.07;
      if (activity === "talk") lift = side ? -0.25 : -0.9 + Math.sin(time * 2.6) * 0.3;
      if (activity === "relax") lift = sit ? -0.55 : Math.sin(time * 0.9 + side) * 0.05;
      if (activity === "wave" && side === 0) {
        lift = 0;
        out = 2.55 + Math.sin(time * 9) * 0.32;
      }
      // The other hand holds out what it needs the person to look at.
      if (activity === "wave" && side === 1) lift = -1.2;
      if (slumped && activity !== "type") lift = sit ? -0.3 : 0.08;
      if (cheering) {
        lift = 0;
        out = sign * (2.7 + Math.sin(time * 12) * 0.15);
      }
      arm.current.rotation.x = lift;
      arm.current.rotation.z = out;
    });
    if (head.current) {
      head.current.rotation.y = activity === "relax" ? Math.sin(time * 0.45) * 0.45 : 0;
      head.current.rotation.x =
        activity === "type"
          ? 0.12 + Math.sin(time * 0.7) * 0.03
          : activity === "talk"
            ? Math.sin(time * 2.6) * 0.06
            : 0;
      head.current.rotation.z = activity === "wave" ? Math.sin(time * 4.5) * 0.06 : 0;
      if (slumped) head.current.rotation.x = 0.42;
      if (cheering) head.current.rotation.x = -0.25;
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
                <Box size={[0.2, 0.26, 0.012]} at={[0, -0.1, 0]} color="#fbfaf6" shadow={false} />
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
        <group ref={head}>
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
        {actor.guest ? (
          <Box
            size={[0.1, 0.13, 0.02]}
            at={[0.1, 0.7, 0.145]}
            color="#f4f1ea"
            round={0.008}
            shadow={false}
          />
        ) : null}
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
