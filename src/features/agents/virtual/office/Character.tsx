import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Vector3, type Group } from "three";
import type { Actor, Goal } from "./behaviour";
import { characterLook } from "./look";
import { advanceWalker, createWalker, finishWalk, turnToward, type Walker } from "./motion";
import { Ball, Box, Capsule } from "./parts";
import { routeTo, type NavGrid } from "./pathfinding";

/** Scene units a figure walks in a second. */
const SPEED = 1.9;
/** Height of the hips when standing; a sitting figure is set down so they rest on the seat. */
const HIP = 0.4;

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
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
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
  onPick(id: string): void;
}) {
  const { actor, goal, grid, still } = props;
  const look = useMemo(() => characterLook(actor.id), [actor.id]);
  const walker = useRef<Walker | null>(null);
  walker.current ??= createWalker(goal.spot, goal.spot.yaw);
  const seated = useRef(goal.spot.sit ? 1 : 0);
  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
  const head = useRef<Group>(null);
  const thighs = [useRef<Group>(null), useRef<Group>(null)];
  const shins = [useRef<Group>(null), useRef<Group>(null)];
  const arms = [useRef<Group>(null), useRef<Group>(null)];
  const phase = useMemo(() => (actor.id.length * 1.7) % 6, [actor.id]);

  useEffect(() => {
    const self = walker.current;
    if (!self) return;
    self.path = routeTo(grid, self, goal.spot, goal.spot.via);
    self.moving = true;
    if (still) {
      finishWalk(self);
      self.yaw = goal.spot.yaw;
      seated.current = goal.spot.sit ? 1 : 0;
    }
  }, [grid, goal.spot, still]);

  const { anchors } = props;
  useEffect(() => {
    anchors.set(actor.id, new Vector3(goal.spot.x, 0, goal.spot.z));
    return () => void anchors.delete(actor.id);
    // The anchor only has to exist; the frame loop keeps it where the figure is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchors, actor.id]);

  useFrame(({ clock, camera }, delta) => {
    const self = walker.current;
    if (!self || !root.current || !body.current) return;
    const step = Math.min(delta, 0.1);
    const time = still ? 0 : clock.elapsedTime + phase;
    // Stand up before setting off, and sit down only once it has arrived.
    const sitting = !self.moving && goal.spot.sit;
    if (!still) {
      if (self.moving && seated.current < 0.5) advanceWalker(self, step, SPEED);
      seated.current += Math.sign((sitting ? 1 : 0) - seated.current) * Math.min(step * 4, 1);
      seated.current = Math.min(1, Math.max(0, seated.current));
    }
    const arrived = !self.moving;
    if (arrived) {
      const toCamera = Math.atan2(camera.position.x - self.x, camera.position.z - self.z);
      const want = goal.activity === "wave" ? toCamera : goal.spot.yaw;
      self.yaw = still ? want : turnToward(self.yaw, want, step * 7);
    }
    const sit = seated.current;
    const walking = self.moving && sit < 0.5;
    const swing = walking ? Math.sin(self.stride * 7) : 0;
    const rise = sit * (goal.spot.seatY + 0.075 - HIP);
    root.current.position.set(
      self.x,
      rise + (walking ? Math.abs(Math.cos(self.stride * 7)) * 0.035 : 0),
      self.z,
    );
    root.current.rotation.y = self.yaw;
    anchors.get(actor.id)?.set(self.x, -0.1, self.z);

    const activity = arrived ? goal.activity : "walk";
    const breath = Math.sin(time * 1.8) * 0.012;
    body.current.position.y = activity === "walk" ? 0 : breath;
    body.current.rotation.x = activity === "type" ? 0.1 : walking ? 0.06 : 0;
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
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.022, 0]}>
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
        <Box size={[0.43, 0.42, 0.28]} at={[0, 0.68, 0]} color={props.shirt} round={0.11} />
        {[0.265, -0.265].map((x, side) => (
          <group key={x} ref={arms[side]} position={[x, 0.82, 0]}>
            <Capsule r={0.062} h={0.3} at={[0, -0.13, 0]} color={props.shirt} shadow={false} />
            <Ball r={0.062} at={[0, -0.31, 0]} color={look.skin} shadow={false} />
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
          <Hair style={look.hairStyle} color={look.hair} hat={look.trousers} />
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
