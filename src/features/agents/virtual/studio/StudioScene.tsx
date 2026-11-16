import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
} from "react";
import { Package } from "lucide-react";
import { PerspectiveCamera, Vector3 } from "three";
import { planGoals, type Actor, type Goal } from "./behaviour";
import { BuildLayer } from "./BuildLayer";
import { Character } from "./Character";
import { ME, type Crowd } from "./crowd";
import type { StudioEmote } from "../studioOrders";
import { GRID, applyRoomSize, type RoomSize } from "./grid";
import { deskOwners, itemCenter, moveItem, type StudioLayout } from "./layout";
import { teamShirts } from "./look";
import { buildNavGrid } from "./pathfinding";
import { studioPlaces } from "./places";
import { screenOf, type ScreenKind } from "./DeskScreen";
import { Piece, type Grab } from "./Piece";
import { Room } from "./Room";
import { Whiteboard } from "./Whiteboard";
import type { BoardRow } from "../studioTalk";
import type { AgentLook, DeskLook } from "../studioLooks";
import {
  ActorTag,
  FREE_DESK_PRIORITY,
  FreeDeskMarker,
  SpeechBubble,
  TagProjector,
  labelPriority,
} from "./Tags";
import { usePageHidden, useReducedMotion } from "./useMotionPreference";
import { Walk } from "./Walk";
import { holdingPointer, pointerHold, releasePointer } from "./pointerLock";
import { ScenePlate, ScenePrompt, SceneReward, SceneSign } from "@/shared/ui";

const TARGET: [number, number, number] = [0, 0.4, 0.6];
const VIEW = { x: 0.6, y: 0.62, z: 0.7 };
/** Seconds between two looks at where the resting agents should drift to next. */
const TICK = 4000;

/**
 * The labels' own stacking layer: they order among themselves (TagProjector gives them large
 * z-indexes), but the whole layer stays under every panel, menu and popup drawn over the room.
 */
const tagLayerClass =
  "pointer-events-none absolute inset-0 isolate z-[var(--stack-above)] overflow-hidden";
/**
 * A point that follows the figure, hidden until TagProjector places it; its label is centred on
 * it, below it, or above it (`data-up`) for what floats over a head.
 */
const tagAnchorClass =
  "invisible absolute top-0 left-0 flex w-0 justify-center will-change-transform data-[up]:h-0 data-[up]:items-end";

type OrbitControlsImpl = ComponentRef<typeof OrbitControls>;

/** How much bigger than the smallest room this one is, which the camera and the light follow. */
const roomScale = (size: RoomSize) => Math.max(size.w / 20, size.d / 13);

/** Sets the camera back far enough to take in the whole room, whatever shape the page is. */
function Framing({ size }: { size: RoomSize }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as OrbitControlsImpl | null;
  const aspect = useThree((state) => state.size.width / Math.max(1, state.size.height));
  const framed = useRef("");
  useEffect(() => {
    const room = `${size.w}x${size.d}`;
    if (framed.current === room || !controls) return;
    framed.current = room;
    const far = 27 * roomScale(size) * Math.max(1, 1.9 / aspect);
    const length = Math.hypot(VIEW.x, VIEW.y, VIEW.z);
    camera.position.set(
      TARGET[0] + (VIEW.x / length) * far,
      TARGET[1] + (VIEW.y / length) * far,
      TARGET[2] + (VIEW.z / length) * far,
    );
    controls.update();
  }, [aspect, camera, controls, size]);
  return null;
}

/**
 * Keeps the overview's depth sharp: the camera's nearest drawn distance follows how far it is from
 * what it looks at. Close up a small one keeps nearby pieces whole; from across the room a larger
 * one gives the flat layers on the floor (rugs, marks, the grid) depths of their own, where they
 * would otherwise trade places from frame to frame and flicker.
 */
function OverviewDepth() {
  const controls = useThree((state) => state.controls) as OrbitControlsImpl | null;
  useFrame(({ camera }) => {
    if (!(camera instanceof PerspectiveCamera) || !controls) return;
    const away = camera.position.distanceTo(controls.target);
    const near = Math.min(4, Math.max(0.5, away * 0.05));
    if (Math.abs(camera.near - near) / near < 0.05) return;
    camera.near = near;
    camera.updateProjectionMatrix();
  });
  return null;
}

/** What of OrbitControls' insides turning by raw mouse movement reaches. */
interface OrbitInsides {
  enabled: boolean;
  state: number;
  rotateSpeed: number;
  panSpeed: number;
  _rotateLeft(angle: number): void;
  _rotateUp(angle: number): void;
  _pan(x: number, y: number): void;
  update(): boolean;
}
const ORBIT = { rotate: 0, pan: 2 };

/**
 * Turning or panning the overview keeps going however far the mouse travels: the pointer is held
 * while a button is down, and its raw movement turns the camera as OrbitControls would have from
 * the pointer's place, which stops changing once it is held. Off in build mode, where a drag
 * moves furniture under the pointer.
 */
function EndlessOrbit(props: { enabled: boolean }) {
  const canvas = useThree((state) => state.gl.domElement);
  const controls = useThree((state) => state.controls) as unknown as OrbitInsides | null;
  useEffect(() => {
    if (!props.enabled) return;
    const hold = pointerHold(canvas);
    const press = (event: PointerEvent) => hold.press(event);
    const move = (event: PointerEvent) => {
      hold.move(event);
      if (!controls?.enabled || !holdingPointer(canvas)) return;
      if (typeof controls._rotateLeft !== "function") return;
      const height = canvas.clientHeight || 1;
      if (controls.state === ORBIT.rotate) {
        controls._rotateLeft(((2 * Math.PI * event.movementX) / height) * controls.rotateSpeed);
        controls._rotateUp(((2 * Math.PI * event.movementY) / height) * controls.rotateSpeed);
      } else if (controls.state === ORBIT.pan) {
        controls._pan(event.movementX * controls.panSpeed, event.movementY * controls.panSpeed);
      } else return;
      controls.update();
    };
    const release = () => hold.release();
    canvas.addEventListener("pointerdown", press);
    document.addEventListener("pointermove", move);
    window.addEventListener("pointerup", release);
    window.addEventListener("blur", release);
    return () => {
      canvas.removeEventListener("pointerdown", press);
      document.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("blur", release);
      releasePointer(canvas);
    };
  }, [canvas, controls, props.enabled]);
  return null;
}

/** Brings the camera over to a figure when it is picked, unless the person is steering already. */
function Follow(props: { id: string | null; anchors: Map<string, Vector3>; still: boolean }) {
  const controls = useThree((state) => state.controls) as OrbitControlsImpl | null;
  const camera = useThree((state) => state.camera);
  const going = useRef(false);
  useEffect(() => {
    going.current = Boolean(props.id);
  }, [props.id]);
  useEffect(() => {
    if (!controls) return;
    const stop = () => (going.current = false);
    controls.addEventListener("start", stop);
    return () => controls.removeEventListener("start", stop);
  }, [controls]);
  useFrame((_, delta) => {
    const anchor = props.id ? props.anchors.get(props.id) : undefined;
    if (!going.current || !anchor || !controls) return;
    const dx = anchor.x - controls.target.x;
    const dz = anchor.z - controls.target.z;
    const ease = props.still ? 1 : Math.min(1, delta * 4);
    controls.target.x += dx * ease;
    controls.target.z += dz * ease;
    camera.position.x += dx * ease;
    camera.position.z += dz * ease;
    if (Math.hypot(dx, dz) < 0.05) going.current = false;
  });
  return null;
}

export interface StudioSceneProps {
  actors: Actor[];
  layout: StudioLayout;
  selected: string | null;
  onSelect(id: string | null): void;
  /** Whoever the person is talking to, who stops and listens. */
  listening?: string | null;
  building: boolean;
  pickedItem: string | null;
  onPickItem(id: string | null): void;
  onLayout(next: StudioLayout): void;
  /** Walk mode: the person walks the room as a figure, and the camera follows them. */
  walking: boolean;
  /** The name each figure goes by in the room, told apart where two share one. */
  names: Map<string, string>;
  /** What a figure is saying, while it answers something asked in the studio. */
  speech: Map<string, string>;
  /** In walk mode, the agent the person has walked up to, or `desk:<id>` for a free desk. */
  onNear?(id: string | null): void;
  /** Hire someone for a free desk. */
  onHireAt?(deskId: string): void;
  /** How each agent was dressed up, and what is on its desk. */
  looks: Record<string, AgentLook>;
  /** A task several agents share, put up on the meeting room's board. */
  board?: { task: string; rows: BoardRow[] } | null;
  /** What the person's own figure acts out, picked from the emote wheel. */
  myEmote?: { kind: StudioEmote; at: number } | null;
  /** Milestones reached, one trophy each on a trophy shelf. */
  trophies?: number;
  /** Walking up to or clicking the arcade cabinet opens its games. */
  onArcade?(): void;
  /** Name tags over the figures, and what they say; off, none shows. */
  namesShown?: boolean;
  /** The key to press for what the person walked up to, floating by it. */
  prompt?: { anchor: string; words: string } | null;
  /** Figures that just earned something, by id, and when: a "+1" rises off each. */
  pops?: Record<string, number>;
  /** Agents with a finished task's result waiting on their desk, to be collected. */
  results?: ReadonlySet<string>;
  /** Picks up an agent's waiting result: walked up to as `result:<agent id>`, or its sign. */
  onCollect?(agentId: string): void;
  /** Told whether walking looks out of the person's own eyes. */
  onFirstPerson?(first: boolean): void;
  /** Whether walking may hold the pointer to look: not while a panel needs the cursor. */
  freeLook?: boolean;
}

/**
 * The studio itself: the room, its furniture, and a figure for every agent, drawn with three.js.
 * Drag to look around, scroll to come closer, pick a figure to see what it is up to. In build mode
 * the furniture can be dragged from cell to cell instead.
 */
export default function StudioScene(props: StudioSceneProps) {
  const { actors, layout, building, onLayout, onPickItem } = props;
  const { size } = layout;
  // Every measure below reads the floor's size, so it is set before any of them is worked out.
  applyRoomSize(size);
  const scale = roomScale(size);
  const still = useReducedMotion();
  const hidden = usePageHidden();
  const [tick, setTick] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: string; x: number; z: number } | null>(null);
  /** When a drag last ended: the click that ends a drag must not count as a click on the floor. */
  const dropped = useRef(0);
  const latest = useRef(layout);
  latest.current = layout;
  const controls = useRef<OrbitControlsImpl>(null);
  const [anchors] = useState(() => new Map<string, Vector3>());
  const [tags] = useState(() => new Map<string, HTMLElement>());
  /** Where everyone stands, so nobody walks into anybody else. */
  const [crowd] = useState<Crowd>(() => new Map());

  useEffect(() => {
    if (still || hidden) return;
    const timer = window.setInterval(() => setTick((known) => known + 1), TICK);
    return () => window.clearInterval(timer);
  }, [still, hidden]);

  const grid = useMemo(() => buildNavGrid(layout.items, size), [layout.items, size]);
  const places = useMemo(() => studioPlaces(layout.items, grid), [layout.items, grid]);
  const own = useMemo(() => actors.filter((actor) => !actor.guest), [actors]);
  const desks = useMemo(
    () =>
      deskOwners(
        layout.items,
        own.map((actor) => actor.id),
      ),
    [layout.items, own],
  );
  // Each plan starts from the last one, so figures keep their places (`planGoals`).
  const lastGoals = useRef(new Map<string, Goal>());
  const goals = useMemo(() => {
    // Read on each plan: sent to the person, a figure finds them wherever they walked to.
    const person = crowd.get(ME);
    const next = planGoals(actors, places, desks, tick, lastGoals.current, person);
    lastGoals.current = next;
    return next;
  }, [actors, places, desks, tick, crowd]);
  const shirts = useMemo(() => teamShirts(actors.map((actor) => actor.id)), [actors]);
  const deskNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const actor of own) {
      const desk = desks.get(actor.id);
      if (desk) names.set(desk, actor.name);
    }
    return names;
  }, [own, desks]);
  const desksShown = useMemo(
    () => layout.items.filter((item) => item.kind === "desk"),
    [layout.items],
  );
  const arcades = useMemo(
    () => layout.items.filter((item) => item.kind === "arcade"),
    [layout.items],
  );
  const { onArcade } = props;
  const openArcade = useCallback(() => onArcade?.(), [onArcade]);
  /** Each waiting result's agent, with the desk it waits on. */
  const parcels = useMemo(() => {
    const at = new Map<string, string>();
    for (const agentId of props.results ?? []) {
      const desk = desks.get(agentId);
      if (desk) at.set(agentId, desk);
    }
    return at;
  }, [props.results, desks]);
  const parcelDesks = useMemo(() => new Set(parcels.values()), [parcels]);
  /** Desks nobody has: each can be hired for, from the room itself. */
  const freeDesks = useMemo(
    () => desksShown.filter((desk) => !deskNames.has(desk.id)),
    [desksShown, deskNames],
  );
  // Your own agents, members (to talk to them) and free desks can be walked up to.
  const walkable = useMemo(
    () => [
      ...actors.filter((actor) => !actor.guest || actor.kind === "member").map((actor) => actor.id),
      ...freeDesks.map((desk) => `desk:${desk.id}`),
      ...arcades.map((arcade) => `arcade:${arcade.id}`),
      ...[...parcels.keys()].map((agentId) => `result:${agentId}`),
    ],
    [actors, freeDesks, arcades, parcels],
  );
  useEffect(() => {
    // A waiting result is walked up to at its desk, where its sign floats.
    const placed: string[] = [];
    for (const [agentId, deskId] of parcels) {
      const desk = layout.items.find((item) => item.id === deskId);
      if (!desk) continue;
      const at = itemCenter(desk);
      anchors.set(`result:${agentId}`, new Vector3(at.x, 1.5, at.z));
      placed.push(`result:${agentId}`);
    }
    return () => {
      for (const key of placed) anchors.delete(key);
    };
  }, [anchors, parcels, layout.items]);
  useEffect(() => {
    // The cabinet is walked up to like a person, to play it.
    for (const arcade of arcades) {
      const at = itemCenter(arcade);
      // Level with the top of the cabinet, where its prompt floats.
      anchors.set(`arcade:${arcade.id}`, new Vector3(at.x, 1.9, at.z));
    }
    return () => {
      for (const arcade of arcades) anchors.delete(`arcade:${arcade.id}`);
    };
  }, [anchors, arcades]);
  useEffect(() => {
    // A desk's name floats over its screen; it only shows in build mode.
    for (const desk of desksShown) {
      const at = itemCenter(desk);
      anchors.set(`desk:${desk.id}`, new Vector3(at.x, 1.5, at.z));
    }
    return () => {
      for (const desk of desksShown) anchors.delete(`desk:${desk.id}`);
    };
  }, [anchors, desksShown]);
  // A desk carries what its agent put on it, whichever desk that is.
  const deskDecor = new Map<string, DeskLook>();
  for (const [agentId, deskId] of desks) {
    const decor = props.looks[agentId]?.desk;
    if (decor) deskDecor.set(deskId, decor);
  }
  // Each desk's monitor shows what its own agent is doing, wherever in the room it is.
  const screens = new Map<string, ScreenKind>();
  for (const actor of own) {
    const desk = desks.get(actor.id);
    const kind = screenOf(actor);
    if (desk && kind) screens.set(desk, kind);
  }
  // Agents sharing a task gather at the first table (`planGoals`), so its board stands there.
  const boardTable = layout.items.find((item) => item.kind === "table");
  const lamps = layout.items.filter((item) => item.kind === "lamp").slice(0, 4);

  const grab = useCallback<Grab>(
    (item, event) => {
      event.stopPropagation();
      const { origin, direction } = event.ray;
      const reach = direction.y ? -origin.y / direction.y : 0;
      drag.current = {
        id: item.id,
        x: origin.x + direction.x * reach + GRID.w / 2 - item.x,
        z: origin.z + direction.z * reach + GRID.d / 2 - item.z,
      };
      if (controls.current) controls.current.enabled = false;
      setDragging(true);
      onPickItem(item.id);
    },
    [onPickItem],
  );
  const dragTo = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      const held = drag.current;
      if (!held) return;
      const x = Math.round(event.point.x + GRID.w / 2 - held.x);
      const z = Math.round(event.point.z + GRID.d / 2 - held.z);
      const next = moveItem(latest.current, held.id, x, z);
      if (next !== latest.current) onLayout(next);
    },
    [onLayout],
  );
  useEffect(() => {
    if (!dragging) return;
    const drop = () => {
      drag.current = null;
      dropped.current = performance.now();
      setDragging(false);
    };
    window.addEventListener("pointerup", drop);
    window.addEventListener("pointercancel", drop);
    return () => {
      window.removeEventListener("pointerup", drop);
      window.removeEventListener("pointercancel", drop);
    };
  }, [dragging]);
  useEffect(() => () => void (document.body.style.cursor = ""), []);

  return (
    <div className="absolute inset-0">
      <Canvas
        // Soft filtering: a wide PCF radius hatched the shadows into stripes seen up close.
        shadows="soft"
        dpr={[1, 2]}
        // Always on: the browser already stops animation frames for a page out of sight. With
        // "never" while document.hidden, not even the first frame was drawn, so a web view that
        // reported the page hidden as the room opened left it blank until it was shown again.
        frameloop="always"
        camera={{ fov: 30, near: 0.5, far: 400, position: [16, 17, 19] }}
        gl={{ antialias: true, alpha: true }}
        onPointerMissed={() => (building ? undefined : props.onSelect(null))}
      >
        <hemisphereLight args={["#fff6e6", "#8f8172", 0.95]} />
        <ambientLight intensity={0.35} />
        <directionalLight
          position={[9 * scale, 17 * scale, 8 * scale]}
          intensity={2.1}
          color="#fff0d8"
          castShadow
          shadow-mapSize={[4096, 4096]}
          shadow-bias={-0.0004}
          shadow-normalBias={0.04}
        >
          <orthographicCamera
            key={`${size.w}x${size.d}`}
            attach="shadow-camera"
            args={[-size.w * 0.75, size.w * 0.75, size.d * 0.95, -size.d * 0.95, 1, 60 * scale]}
          />
        </directionalLight>
        <Room key={`${size.w}x${size.d}`} size={size} />
        {layout.items.map((item) => (
          <Piece
            key={item.id}
            item={item}
            screen={screens.get(item.id) ?? null}
            decor={deskDecor.get(item.id)}
            parcel={!building && parcelDesks.has(item.id)}
            still={still}
            glow={lamps.includes(item)}
            trophies={item.kind === "trophies" ? props.trophies : undefined}
            onGrab={building ? grab : undefined}
            onUse={item.kind === "arcade" && onArcade ? openArcade : undefined}
          />
        ))}
        {actors.map((actor) => {
          const goal = goals.get(actor.id);
          if (!goal) return null;
          return (
            <Character
              key={actor.id}
              actor={actor}
              goal={goal}
              grid={grid}
              shirt={shirts.get(actor.id) ?? "#4d9de0"}
              selected={!building && props.selected === actor.id}
              still={still}
              quiet={building}
              listening={!building && props.listening === actor.id}
              crowd={crowd}
              anchors={anchors}
              figure={props.looks[actor.id]?.figure}
              onPick={props.onSelect}
            />
          );
        })}
        {props.board && boardTable && !building ? (
          <Whiteboard
            at={itemCenter(boardTable)}
            task={props.board.task}
            rows={props.board.rows}
            names={props.names}
          />
        ) : null}
        {building ? (
          <BuildLayer
            key={`${size.w}x${size.d}`}
            items={layout.items}
            picked={props.pickedItem}
            onDrag={dragTo}
            onFloorClick={() => performance.now() - dropped.current > 300 && onPickItem(null)}
          />
        ) : null}
        {props.walking && !building ? (
          <Walk
            grid={grid}
            still={still}
            anchors={anchors}
            crowd={crowd}
            people={walkable}
            emote={props.myEmote}
            onNear={props.onNear}
            onFirstPerson={props.onFirstPerson}
            freeLook={props.freeLook}
          />
        ) : (
          <>
            <OrbitControls
              ref={controls}
              makeDefault
              enabled={!dragging}
              enableDamping={!still}
              dampingFactor={0.12}
              target={TARGET}
              minDistance={4}
              maxDistance={56 * scale}
              minPolarAngle={0.2}
              maxPolarAngle={1.36}
              screenSpacePanning={false}
              zoomSpeed={0.8}
              onChange={() => {
                const target = controls.current?.target;
                if (!target) return;
                target.x = Math.min(GRID.w / 2, Math.max(-GRID.w / 2, target.x));
                target.z = Math.min(GRID.d / 2, Math.max(-GRID.d / 2, target.z));
                target.y = TARGET[1];
              }}
            />
            <Framing size={size} />
            <OverviewDepth />
            <EndlessOrbit enabled={!building} />
            <Follow id={building ? null : props.selected} anchors={anchors} still={still} />
          </>
        )}
        <TagProjector anchors={anchors} tags={tags} shown={props.namesShown !== false} />
      </Canvas>
      {building ? (
        <div className={tagLayerClass}>
          {desksShown.map((desk) => (
            <div
              key={desk.id}
              className={tagAnchorClass}
              ref={(node) => {
                if (node) tags.set(`desk:${desk.id}`, node);
                else tags.delete(`desk:${desk.id}`);
              }}
            >
              <ScenePlate empty={!deskNames.get(desk.id)}>
                {deskNames.get(desk.id) ?? "Free desk"}
              </ScenePlate>
            </div>
          ))}
        </div>
      ) : (
        <div className={tagLayerClass}>
          {/* Only the next free desk is marked, as a game marks the next plot; walking up to any
              free desk offers it too. */}
          {props.onHireAt
            ? freeDesks.slice(0, 1).map((desk) => (
                <div
                  key={desk.id}
                  className={tagAnchorClass}
                  data-up="true"
                  data-anchor={`desk:${desk.id}`}
                  data-priority={FREE_DESK_PRIORITY}
                  ref={(node) => {
                    if (node) tags.set(`free:${desk.id}`, node);
                    else tags.delete(`free:${desk.id}`);
                  }}
                >
                  <FreeDeskMarker onHire={() => props.onHireAt?.(desk.id)} />
                </div>
              ))
            : null}
          {[...parcels.keys()].map((agentId) => (
            <div
              key={`result:${agentId}`}
              className={tagAnchorClass}
              data-up="true"
              data-anchor={`result:${agentId}`}
              data-priority={2.5}
              ref={(node) => {
                if (node) tags.set(`result:${agentId}`, node);
                else tags.delete(`result:${agentId}`);
              }}
            >
              <SceneSign
                type="button"
                icon={<Package aria-hidden="true" />}
                aria-label={`Collect ${props.names.get(agentId) ?? "agent"}'s result`}
                onClick={() => props.onCollect?.(agentId)}
              >
                Result
              </SceneSign>
            </div>
          ))}
          {props.prompt ? (
            // Over everything of its figure's: it is what the person is about to do.
            <div
              className={tagAnchorClass}
              data-up="true"
              data-anchor={props.prompt.anchor}
              data-priority={3.9}
              ref={(node) => {
                if (node) tags.set("prompt", node);
                else tags.delete("prompt");
              }}
            >
              <ScenePrompt keyName="E">{props.prompt.words}</ScenePrompt>
            </div>
          ) : null}
          {Object.entries(props.pops ?? {}).map(([id, at]) => (
            <div
              key={`${id}:${at}`}
              className={tagAnchorClass}
              data-up="true"
              data-anchor={`head:${id}`}
              data-priority={3.8}
              ref={(node) => {
                if (node) tags.set(`pop:${id}`, node);
                else tags.delete(`pop:${id}`);
              }}
            >
              <SceneReward>+1</SceneReward>
            </div>
          ))}
          {actors.map((actor) => {
            const picked = props.selected === actor.id;
            const speech = props.speech.get(actor.id) ?? "";
            const priority = labelPriority(actor, picked);
            return (
              <Fragment key={actor.id}>
                <div
                  className={tagAnchorClass}
                  data-up="true"
                  data-anchor={`head:${actor.id}`}
                  data-priority={priority}
                  ref={(node) => {
                    if (node) tags.set(`name:${actor.id}`, node);
                    else tags.delete(`name:${actor.id}`);
                  }}
                >
                  <ActorTag
                    actor={actor}
                    name={props.names.get(actor.id) ?? actor.name}
                    selected={picked}
                    onPick={props.onSelect}
                  />
                </div>
                {speech ? (
                  // Placed after its name, so it stacks above it.
                  <div
                    className={tagAnchorClass}
                    data-up="true"
                    data-anchor={`head:${actor.id}`}
                    data-priority={priority + 0.5}
                    ref={(node) => {
                      if (node) tags.set(`say:${actor.id}`, node);
                      else tags.delete(`say:${actor.id}`);
                    }}
                  >
                    <SpeechBubble speech={speech} />
                  </div>
                ) : null}
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
