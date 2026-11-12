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
import { Vector3 } from "three";
import { planGoals, type Actor, type Goal } from "./behaviour";
import { BuildLayer } from "./BuildLayer";
import { Character } from "./Character";
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

const TARGET: [number, number, number] = [0, 0.4, 0.6];
const VIEW = { x: 0.6, y: 0.62, z: 0.7 };
/** Seconds between two looks at where the resting agents should drift to next. */
const TICK = 4000;

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
  /** Footsteps as the person walks. */
  footsteps?: boolean;
  /** A task several agents share, put up on the meeting room's board. */
  board?: { task: string; rows: BoardRow[] } | null;
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
    const next = planGoals(actors, places, desks, tick, lastGoals.current);
    lastGoals.current = next;
    return next;
  }, [actors, places, desks, tick]);
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
  /** Desks nobody has: each can be hired for, from the room itself. */
  const freeDesks = useMemo(
    () => desksShown.filter((desk) => !deskNames.has(desk.id)),
    [desksShown, deskNames],
  );
  const walkable = useMemo(
    () => [...own.map((actor) => actor.id), ...freeDesks.map((desk) => `desk:${desk.id}`)],
    [own, freeDesks],
  );
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
    <div className="virtual-studio-stage">
      <Canvas
        shadows="percentage"
        dpr={[1, 2]}
        frameloop={hidden ? "never" : "always"}
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
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0004}
          shadow-normalBias={0.04}
          shadow-radius={5}
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
            still={still}
            glow={lamps.includes(item)}
            onGrab={building ? grab : undefined}
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
            people={walkable}
            footsteps={props.footsteps}
            onNear={props.onNear}
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
            <Follow id={building ? null : props.selected} anchors={anchors} still={still} />
          </>
        )}
        <TagProjector anchors={anchors} tags={tags} />
      </Canvas>
      {building ? (
        <div className="virtual-studio-tags">
          {desksShown.map((desk) => (
            <div
              key={desk.id}
              className="virtual-studio-tag-anchor"
              ref={(node) => {
                if (node) tags.set(`desk:${desk.id}`, node);
                else tags.delete(`desk:${desk.id}`);
              }}
            >
              <span
                className="virtual-studio-desk-tag"
                data-free={!deskNames.get(desk.id) || undefined}
              >
                {deskNames.get(desk.id) ?? "Free desk"}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="virtual-studio-tags">
          {/* Only the next free desk is marked, as a game marks the next plot; walking up to any
              free desk offers it too. */}
          {props.onHireAt
            ? freeDesks.slice(0, 1).map((desk) => (
                <div
                  key={desk.id}
                  className="virtual-studio-tag-anchor"
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
          {actors.map((actor) => {
            const picked = props.selected === actor.id;
            const speech = props.speech.get(actor.id) ?? "";
            const priority = labelPriority(actor, picked);
            return (
              <Fragment key={actor.id}>
                <div
                  className="virtual-studio-tag-anchor"
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
                    className="virtual-studio-tag-anchor"
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
