import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { PerspectiveCamera, Vector3, type Group } from "three";
import { typingIn } from "./keys";
import { GRID, cellCenter, cellOf, facing, type Point } from "./grid";
import { studioSounds } from "../studioSounds";
import { turnToward } from "./motion";
import { Ball, Box, Capsule, FLOOR_MARK } from "./parts";
import { isWalkable, nearestWalkable, type NavGrid } from "./pathfinding";

/** Top walking speed in scene units a second, and how quickly it is reached and lost. */
const SPEED = 4.2;
const GRIP = 14;
/** How hard a jump leaves the floor, and how hard the room pulls back down. */
const JUMP = 5.4;
const GRAVITY = 17;
/** How fast the figure turns to face the way it walks, in radians a second. */
const TURN = 12;
/** How far from the middle of a figure nothing solid may be. */
const GIRTH = 0.28;
/** The camera: how far it starts from the figure, how near and far it may be wheeled, its tilt. */
const DISTANCE = { start: 6.5, least: 2.2, most: 13 };
const PITCH = { start: 0.42, least: 0.08, most: 1.25 };
/** Radians the camera turns per pixel dragged. */
const LOOK = 0.0055;
/** The point on the figure the camera looks at: about its shoulders. */
const EYE = 1.15;
const WALK_FOV = 50;
/** Scene units between two footfalls. */
const STEP = Math.PI / 5.5;
/** How near an agent the person must walk, in scene units, to talk to it. */
const TALKING_DISTANCE = 1.8;

type Move = "ahead" | "back" | "left" | "right" | "jump";
const keys: Record<string, Move> = {
  KeyW: "ahead",
  ArrowUp: "ahead",
  KeyS: "back",
  ArrowDown: "back",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  Space: "jump",
};

/** Whether a figure can stand at a place: its middle and its four sides are on free floor. */
function free(grid: NavGrid, at: Point): boolean {
  const edges = [
    [0, 0],
    [GIRTH, 0],
    [-GIRTH, 0],
    [0, GIRTH],
    [0, -GIRTH],
  ];
  return edges.every(([dx, dz]) => isWalkable(grid, cellOf({ x: at.x + dx!, z: at.z + dz! })));
}

/** The person's figure: where it stands, how high it is off the floor, and how it is moving. */
export interface Walker {
  x: number;
  z: number;
  /** Height of the feet over the floor; 0 on the floor. */
  y: number;
  yaw: number;
  vx: number;
  vz: number;
  vy: number;
  stride: number;
}

/** The keys held, and which way the camera looks along the floor (its yaw). */
export interface WalkInput {
  held: ReadonlySet<Move>;
  cameraYaw: number;
}

/**
 * One step of walking, as in a game played over the shoulder: the keys move the figure relative to
 * the camera, W away from it, S toward it, A and D to the sides, and together on a slant. Speed
 * builds and falls off quickly rather than at once, the figure turns to face where it goes, Space
 * jumps when it is on the floor, and furniture and walls stop it, each axis on its own so it slides
 * along them instead of sticking.
 */
export function stepWalker(
  self: Walker,
  input: WalkInput,
  seconds: number,
  canStand: (at: Point) => boolean,
): void {
  const on = (move: Move) => (input.held.has(move) ? 1 : 0);
  // Away from the camera along the floor, and to its right.
  const ahead = { x: -Math.sin(input.cameraYaw), z: -Math.cos(input.cameraYaw) };
  const right = { x: -ahead.z, z: ahead.x };
  const forward = on("ahead") - on("back");
  const side = on("right") - on("left");
  let wantX = ahead.x * forward + right.x * side;
  let wantZ = ahead.z * forward + right.z * side;
  const length = Math.hypot(wantX, wantZ);
  if (length > 0) [wantX, wantZ] = [(wantX / length) * SPEED, (wantZ / length) * SPEED];
  // Less grip in the air, so a jump carries on the way it was going.
  const grip = Math.min(1, seconds * (self.y > 0 ? GRIP / 4 : GRIP));
  self.vx += (wantX - self.vx) * grip;
  self.vz += (wantZ - self.vz) * grip;
  if (Math.abs(self.vx) < 1e-3) self.vx = 0;
  if (Math.abs(self.vz) < 1e-3) self.vz = 0;

  const alongX = { x: self.x + self.vx * seconds, z: self.z };
  if (canStand(alongX)) self.x = alongX.x;
  else self.vx = 0;
  const alongZ = { x: self.x, z: self.z + self.vz * seconds };
  if (canStand(alongZ)) self.z = alongZ.z;
  else self.vz = 0;

  if (on("jump") && self.y === 0 && self.vy === 0) self.vy = JUMP;
  self.vy -= GRAVITY * seconds;
  self.y += self.vy * seconds;
  if (self.y <= 0) [self.y, self.vy] = [0, 0];

  const speed = Math.hypot(self.vx, self.vz);
  if (length > 0) self.yaw = turnToward(self.yaw, Math.atan2(wantX, wantZ), seconds * TURN);
  if (self.y === 0) self.stride += speed * seconds;
}

/** The agent nearest the person and in front of them, within talking distance, if any. */
export function nearestAhead(
  self: { x: number; z: number; yaw: number },
  people: readonly string[],
  anchors: Map<string, Point>,
): string | null {
  const way = facing(self.yaw);
  let best: string | null = null;
  let bestScore = Infinity;
  for (const id of people) {
    const at = anchors.get(id);
    if (!at) continue;
    const dx = at.x - self.x;
    const dz = at.z - self.z;
    const distance = Math.hypot(dx, dz);
    if (distance > TALKING_DISTANCE) continue;
    // Someone behind the person isn't who they are talking to.
    const ahead = distance < 0.4 ? 1 : (dx * way.x + dz * way.z) / distance;
    if (ahead < 0.2) continue;
    const score = distance * (2 - ahead);
    if (score < bestScore) [best, bestScore] = [id, score];
  }
  return best;
}

/**
 * Walk mode: the person is a figure in the room, played over the shoulder. Dragging turns the
 * camera around them and the wheel brings it nearer or farther; W, A, S and D or the arrows walk
 * in every direction from where the camera looks, and Space jumps. Furniture and walls stop the
 * figure, and the camera keeps inside the room, so everyone's work can be seen from among them.
 */
export function Walk(props: {
  grid: NavGrid;
  still: boolean;
  /** Where each figure is, kept current by the figures. */
  anchors: Map<string, Point>;
  /** The agents the person can talk to. */
  people: readonly string[];
  onNear?(id: string | null): void;
  /** Play a footstep sound with each step. */
  footsteps?: boolean;
}) {
  const { grid, still } = props;
  const camera = useThree((state) => state.camera);
  const canvas = useThree((state) => state.gl.domElement);
  const figure = useRef<Group>(null);
  const legs = [useRef<Group>(null), useRef<Group>(null)];
  const arms = [useRef<Group>(null), useRef<Group>(null)];
  const held = useRef(new Set<Move>());
  const near = useRef<string | null>(null);
  const onNear = useRef(props.onNear);
  onNear.current = props.onNear;
  const state = useRef<Walker | null>(null);
  if (!state.current) {
    // In by the door, looking into the room.
    const start = nearestWalkable(grid, { x: 3, z: 10 }) ?? { x: 3, z: 10 };
    state.current = {
      ...cellCenter(start),
      y: 0,
      yaw: Math.PI / 2,
      vx: 0,
      vz: 0,
      vy: 0,
      stride: 0,
    };
  }
  // The camera starts behind the figure, looking the way it faces.
  const view = useRef({ yaw: -Math.PI / 2, pitch: PITCH.start, distance: DISTANCE.start });

  useEffect(
    () => () => {
      if (near.current) onNear.current?.(null);
    },
    [],
  );

  useEffect(() => {
    // The Walk button keeps focus after it is pressed, and Space would press it again.
    if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
    const down = (event: KeyboardEvent) => {
      const move = keys[event.code];
      if (!move || typingIn(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      held.current.add(move);
    };
    const up = (event: KeyboardEvent) => {
      const move = keys[event.code];
      if (move) held.current.delete(move);
    };
    const drop = () => held.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", drop);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", drop);
    };
  }, []);

  useEffect(() => {
    // Dragging with any button turns the camera around the figure; the wheel moves it in and out.
    let last: { x: number; y: number } | null = null;
    const press = (event: PointerEvent) => {
      last = { x: event.clientX, y: event.clientY };
    };
    const move = (event: PointerEvent) => {
      if (!last) return;
      const turn = view.current;
      turn.yaw -= (event.clientX - last.x) * LOOK;
      turn.pitch = Math.min(
        PITCH.most,
        Math.max(PITCH.least, turn.pitch + (event.clientY - last.y) * LOOK),
      );
      last = { x: event.clientX, y: event.clientY };
    };
    const release = () => {
      last = null;
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const turn = view.current;
      turn.distance = Math.min(
        DISTANCE.most,
        Math.max(DISTANCE.least, turn.distance * Math.exp(event.deltaY * 0.0015)),
      );
    };
    const menu = (event: MouseEvent) => event.preventDefault();
    canvas.addEventListener("pointerdown", press);
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("contextmenu", menu);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", release);
    return () => {
      canvas.removeEventListener("pointerdown", press);
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("contextmenu", menu);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
    };
  }, [canvas]);

  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return;
    const before = camera.fov;
    camera.fov = WALK_FOV;
    camera.updateProjectionMatrix();
    return () => {
      camera.fov = before;
      camera.updateProjectionMatrix();
    };
  }, [camera]);

  const eye = useRef(new Vector3());
  const settled = useRef(false);
  useFrame((_, delta) => {
    const self = state.current;
    if (!self) return;
    const step = Math.min(delta, 0.05);
    const turn = view.current;
    const strideBefore = self.stride;
    stepWalker(self, { held: held.current, cameraYaw: turn.yaw }, step, (at) => free(grid, at));
    // A step sounds each time a foot comes down: twice a stride.
    if (props.footsteps && Math.floor(self.stride / STEP) !== Math.floor(strideBefore / STEP))
      studioSounds.step();
    const speed = Math.hypot(self.vx, self.vz) / SPEED;
    const airborne = self.y > 0;
    const swing = still || airborne ? 0 : Math.sin(self.stride * 5.5) * Math.min(1, speed * 1.4);
    if (figure.current) {
      const bob = still || airborne ? 0 : Math.abs(swing) * 0.03;
      figure.current.position.set(self.x, self.y + bob, self.z);
      figure.current.rotation.y = self.yaw;
    }
    legs.forEach((leg, side) => {
      if (!leg.current) return;
      // Knees up in the air, swinging on the floor.
      leg.current.rotation.x = airborne ? -0.5 : swing * 0.7 * (side ? -1 : 1);
    });
    arms.forEach((arm, side) => {
      if (!arm.current) return;
      arm.current.rotation.x = airborne ? -0.4 : -swing * 0.6 * (side ? -1 : 1);
      arm.current.rotation.z = (side ? -1 : 1) * (airborne ? 0.5 : 0.06);
    });

    // The camera on its sphere round the figure's shoulders, kept inside the walls where it can be.
    const reach = (limit: number, value: number) => Math.min(limit, Math.max(-limit, value));
    const flat = Math.cos(turn.pitch) * turn.distance;
    eye.current.set(
      reach(GRID.w / 2 + 1.5, self.x + Math.sin(turn.yaw) * flat),
      Math.max(0.6, EYE + self.y * 0.5 + Math.sin(turn.pitch) * turn.distance),
      reach(GRID.d / 2 + 1.5, self.z + Math.cos(turn.yaw) * flat),
    );
    if (settled.current && !still) camera.position.lerp(eye.current, Math.min(1, step * 14));
    else camera.position.copy(eye.current);
    settled.current = true;
    camera.lookAt(self.x, EYE + self.y * 0.5, self.z);

    const nearest = nearestAhead(self, props.people, props.anchors);
    if (nearest !== near.current) {
      near.current = nearest;
      onNear.current?.(nearest);
    }
  });

  const start = state.current;
  return (
    <group ref={figure} position={[start.x, 0, start.z]} rotation={[0, start.yaw, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_MARK, 0]}>
        <ringGeometry args={[0.34, 0.42, 40]} />
        <meshBasicMaterial color="#f1f1f1" transparent opacity={0.85} />
      </mesh>
      {[0.105, -0.105].map((x, side) => (
        <group key={x} ref={legs[side]} position={[x, 0.4, 0]}>
          <Capsule r={0.078} h={0.5} at={[0, -0.2, 0]} color="#2b2f3a" />
        </group>
      ))}
      <Box size={[0.43, 0.46, 0.28]} at={[0, 0.66, 0]} color="#f1f1f1" round={0.11} />
      {[0.265, -0.265].map((x, side) => (
        <group key={x} ref={arms[side]} position={[x, 0.84, 0]}>
          <Capsule r={0.062} h={0.32} at={[0, -0.16, 0]} color="#f1f1f1" shadow={false} />
          <Ball r={0.062} at={[0, -0.34, 0]} color="#e8b98f" shadow={false} />
        </group>
      ))}
      <Ball r={0.24} at={[0, 1.08, 0]} scale={[1, 0.96, 0.96]} color="#e8b98f" />
      <Ball r={0.027} at={[0.085, 1.09, 0.212]} color="#2a2420" shadow={false} />
      <Ball r={0.027} at={[-0.085, 1.09, 0.212]} color="#2a2420" shadow={false} />
    </group>
  );
}
