import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { PerspectiveCamera, Vector3, type Group } from "three";
import { ME, clearOf, type Crowd } from "./crowd";
import { EMOTE_MS, type StudioEmote } from "../studioOrders";
import { emotePose } from "./emotes";
import { typingIn } from "./keys";
import { holdPointer, holdingPointer, releasePointer } from "./pointerLock";
import { walkView } from "./view";
import { GRID, cellCenter, facing, type Point } from "./grid";
import { turnToward } from "./motion";
import { Ball, Box, Capsule, FLOOR_MARK } from "./parts";
import { bodyFree, nearestWalkable, type NavGrid } from "./pathfinding";

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
/** The camera over the shoulder: how far it comes out to from first person, how near and far it
 * may be wheeled, and its tilt. Wheeled in past `least`, it goes into the figure's head. */
const DISTANCE = { start: 6.5, least: 2.2, most: 13 };
const PITCH = { start: 0.42, least: 0.08, most: 1.25 };
/** Looking out of the figure's eyes: its tilt, down for positive, as over the shoulder. */
const LOOK_PITCH = { start: 0.12, least: -1.2, most: 1.3 };
/** Where the eyes are, over the feet. */
const HEAD = 1.12;
/** The view's width: wide from the eyes, as a game's first person is, narrower over the shoulder. */
const FIRST_FOV = 72;
/** The nearest the camera draws: close enough not to cut into a desk walked up to. */
const WALK_NEAR = 0.08;
/** Radians the camera turns per pixel the mouse moves. */
const LOOK = 0.0055;
/** The point on the figure the camera looks at: about its shoulders. */
const EYE = 1.15;
const WALK_FOV = 50;

/** Whether the walk looks out of the figure's eyes, remembered while the window is open. */
let lastFirst = true;
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

/** Whether the figure's whole body, round, is clear of every solid piece. */
const free = (grid: NavGrid, at: Point): boolean => bodyFree(grid, at, GIRTH);

/** The floor as the person's figure finds it: chairs are in the way too, since it never sits. */
function withChairs(grid: NavGrid): NavGrid {
  if (!grid.seats) return grid;
  const blocked = grid.blocked.slice();
  grid.seats.forEach((seat, index) => {
    if (seat) blocked[index] = 1;
  });
  return { blocked };
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
 * Walk mode: the person is a figure in the room, walked through in first person, as an office is
 * walked through, or played over the shoulder. Dragging looks around (or turns the camera around
 * them), and the wheel goes from one to the other: out of the figure's head to behind it, and
 * nearer until it is back in its eyes. W, A, S and D or the arrows walk in every direction from
 * where the camera looks, and Space jumps. Furniture and walls stop the figure, and the camera
 * keeps inside the room, so everyone's work can be seen from among them.
 */
export function Walk(props: {
  grid: NavGrid;
  still: boolean;
  /** Where each figure is, kept current by the figures. */
  anchors: Map<string, Point>;
  /** Everyone on the floor: the person's figure walks round them, and they round it. */
  crowd: Crowd;
  /** The agents the person can talk to. */
  people: readonly string[];
  onNear?(id: string | null): void;
  /** What the person picked from the emote wheel, acted out by their figure for a moment. */
  emote?: { kind: StudioEmote; at: number } | null;
  /** Told whether the walk looks out of the figure's eyes, at the start and on every change. */
  onFirstPerson?(first: boolean): void;
  /** Whether the room may hold the pointer to look. Off while a panel needs the cursor. */
  freeLook?: boolean;
}) {
  const { still, crowd } = props;
  const grid = useMemo(() => withChairs(props.grid), [props.grid]);
  const freeLook = Boolean(props.freeLook);
  const camera = useThree((state) => state.camera);
  const canvas = useThree((state) => state.gl.domElement);
  const getScene = useThree((state) => state.get);
  const setEvents = useThree((state) => state.setEvents);
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
  // The camera starts looking the way the figure faces: out of its eyes, or from behind it.
  const view = useRef({
    yaw: -Math.PI / 2,
    pitch: lastFirst ? LOOK_PITCH.start : PITCH.start,
    distance: DISTANCE.start,
    first: lastFirst,
  });
  const onFirstPerson = useRef(props.onFirstPerson);
  onFirstPerson.current = props.onFirstPerson;
  useEffect(() => onFirstPerson.current?.(view.current.first), []);

  useEffect(
    () => () => {
      if (near.current) onNear.current?.(null);
      crowd.delete(ME);
      walkView.active = false;
    },
    [crowd],
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
    // A free camera, as a game's is: a click into the room holds the pointer, and from then on
    // the mouse turns the camera with no button down until Escape lets it go. The wheel moves it
    // in and out.
    // The click that takes hold of the pointer only does that: it picks nothing in the room.
    let grabbing = false;
    const press = (event: PointerEvent) => {
      grabbing = false;
      if (!freeLook || event.pointerType !== "mouse" || holdingPointer(canvas)) return;
      grabbing = true;
      holdPointer(canvas);
    };
    const click = (event: MouseEvent) => {
      if (!grabbing) return;
      grabbing = false;
      event.stopPropagation();
    };
    const move = (event: PointerEvent) => {
      if (!holdingPointer(canvas)) return;
      const turn = view.current;
      const limits = turn.first ? LOOK_PITCH : PITCH;
      turn.yaw -= event.movementX * LOOK;
      turn.pitch = Math.min(
        limits.most,
        Math.max(limits.least, turn.pitch + event.movementY * LOOK),
      );
    };
    const leave = () => releasePointer(canvas);
    // Escape gives the cursor back. A web view's own lock does that by itself; a cursor the
    // window grabbed is let go here, before Escape does anything else in the studio.
    const escape = (event: KeyboardEvent) => {
      if (event.code !== "Escape" || !holdingPointer(canvas)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      releasePointer(canvas);
    };
    window.addEventListener("keydown", escape, true);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const turn = view.current;
      const switchTo = (first: boolean) => {
        turn.first = lastFirst = first;
        turn.pitch = first ? LOOK_PITCH.start : PITCH.start;
        onFirstPerson.current?.(first);
      };
      if (turn.first) {
        // Wheeled out of the eyes, the camera steps back behind the figure.
        if (event.deltaY <= 0) return;
        turn.distance = DISTANCE.least;
        switchTo(false);
        return;
      }
      const next = turn.distance * Math.exp(event.deltaY * 0.0015);
      // Wheeled in past the nearest over the shoulder, it goes into the figure's eyes.
      if (next < DISTANCE.least && event.deltaY < 0) return switchTo(true);
      turn.distance = Math.min(DISTANCE.most, Math.max(DISTANCE.least, next));
    };
    const menu = (event: MouseEvent) => event.preventDefault();
    canvas.addEventListener("pointerdown", press);
    canvas.addEventListener("click", click);
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("contextmenu", menu);
    window.addEventListener("pointermove", move);
    window.addEventListener("blur", leave);
    return () => {
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("blur", leave);
      releasePointer(canvas);
      canvas.removeEventListener("pointerdown", press);
      canvas.removeEventListener("click", click);
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("contextmenu", menu);
      window.removeEventListener("pointermove", move);
    };
  }, [canvas, freeLook]);

  useEffect(() => {
    // While the pointer is held, the cursor stands still wherever it was, so clicks and hovers aim
    // where the crosshair is instead: the middle of the view.
    const before = getScene().events.compute;
    setEvents({
      compute(event, state, previous) {
        if (!holdingPointer(canvas)) return before?.(event, state, previous);
        state.pointer.set(0, 0);
        state.raycaster.setFromCamera(state.pointer, state.camera);
      },
    });
    return () => setEvents({ compute: before });
  }, [canvas, getScene, setEvents]);

  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return;
    const before = { fov: camera.fov, near: camera.near };
    camera.fov = view.current.first ? FIRST_FOV : WALK_FOV;
    camera.near = WALK_NEAR;
    camera.updateProjectionMatrix();
    return () => {
      camera.fov = before.fov;
      camera.near = before.near;
      camera.updateProjectionMatrix();
    };
  }, [camera]);

  const eye = useRef(new Vector3());
  const settled = useRef(false);

  /** The camera on its sphere round the figure's shoulders, kept inside the walls where it can. */
  function overShoulder(
    self: Walker,
    turn: { yaw: number; pitch: number; distance: number },
    ease: number,
  ) {
    const reach = (limit: number, value: number) => Math.min(limit, Math.max(-limit, value));
    const flat = Math.cos(turn.pitch) * turn.distance;
    eye.current.set(
      reach(GRID.w / 2 + 1.5, self.x + Math.sin(turn.yaw) * flat),
      Math.max(0.6, EYE + self.y * 0.5 + Math.sin(turn.pitch) * turn.distance),
      reach(GRID.d / 2 + 1.5, self.z + Math.cos(turn.yaw) * flat),
    );
    if (settled.current && !still) camera.position.lerp(eye.current, Math.min(1, ease));
    else camera.position.copy(eye.current);
    settled.current = true;
    camera.lookAt(self.x, EYE + self.y * 0.5, self.z);
    // Inside walls between the camera and the figure get out of the way.
    walkView.active = true;
    walkView.target.set(self.x, EYE + self.y * 0.5, self.z);
  }

  useFrame((_, delta) => {
    const self = state.current;
    if (!self) return;
    const step = Math.min(delta, 0.05);
    const turn = view.current;
    // Furniture and walls stop the figure, and so does everyone else in the room.
    const from = { x: self.x, z: self.z };
    stepWalker(
      self,
      { held: held.current, cameraYaw: turn.yaw },
      step,
      (at) => free(grid, at) && clearOf(ME, crowd, at, from),
    );
    // Looking out of the figure's eyes, it faces where they look, which is who it talks to.
    if (turn.first) self.yaw = turn.yaw + Math.PI;
    crowd.set(ME, { x: self.x, z: self.z, moving: Math.hypot(self.vx, self.vz) > 0.05 });
    const speed = Math.hypot(self.vx, self.vz) / SPEED;
    const airborne = self.y > 0;
    const swing = still || airborne ? 0 : Math.sin(self.stride * 5.5) * Math.min(1, speed * 1.4);
    if (figure.current) {
      figure.current.position.set(self.x, self.y, self.z);
      figure.current.rotation.y = self.yaw;
      // Out of its own eyes the figure isn't drawn, nor does it throw a shadow in the way.
      figure.current.visible = !turn.first;
    }
    // In the air the legs stay nearly straight under the figure: one a little ahead on the way up,
    // both easing back under it as it comes down, ready to land.
    const rising = Math.max(0, Math.min(1, self.vy / JUMP));
    legs.forEach((leg, side) => {
      if (!leg.current) return;
      leg.current.rotation.x = airborne
        ? (side ? 0.12 : -0.28) * rising + 0.06 * (1 - rising)
        : swing * 0.7 * (side ? -1 : 1);
    });
    // An emote plays while the figure stands; walking off ends it.
    const emote = props.emote;
    const age = emote ? (Date.now() - emote.at) / 1000 : Infinity;
    const acting = !still && emote && age < EMOTE_MS / 1000 && speed < 0.1 && !airborne;
    arms.forEach((arm, side) => {
      if (!arm.current) return;
      let lift = airborne ? -0.4 : -swing * 0.6 * (side ? -1 : 1);
      let out = (side ? -1 : 1) * (airborne ? 0.5 : 0.06);
      if (acting) [lift, out] = emotePose(emote.kind, side, age, lift, out);
      arm.current.rotation.x = lift;
      arm.current.rotation.z = out;
    });
    if (figure.current && acting && emote.kind === "dance") {
      figure.current.rotation.z = Math.sin(age * 6) * 0.14;
      figure.current.position.y += Math.abs(Math.sin(age * 6)) * 0.08;
    } else if (figure.current) figure.current.rotation.z = 0;

    if (camera instanceof PerspectiveCamera) {
      const fov = turn.first ? FIRST_FOV : WALK_FOV;
      if (camera.fov !== fov) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
    }
    if (turn.first) {
      // In the figure's head, held level as it walks, looking where the mouse turned it.
      eye.current.set(self.x, HEAD + self.y, self.z);
      camera.position.copy(eye.current);
      const flat = Math.cos(turn.pitch);
      camera.lookAt(
        eye.current.x - Math.sin(turn.yaw) * flat,
        eye.current.y - Math.sin(turn.pitch),
        eye.current.z - Math.cos(turn.yaw) * flat,
      );
      // Wheeled out, the camera glides back from here.
      settled.current = true;
      // Nothing stands between the eyes and themselves: every inside wall stays up.
      walkView.active = true;
      walkView.target.copy(eye.current);
    } else {
      overShoulder(self, turn, step * 14);
    }

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
