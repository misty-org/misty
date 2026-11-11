import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import { Vector3 } from "three";
import { Pressable } from "@/shared/ui";
import { planGoals, type Actor } from "./behaviour";
import { BuildLayer } from "./BuildLayer";
import { Character } from "./Character";
import { Armchair, CoffeeTable, Lamp, Plant, Rug, Sofa } from "./FurnitureLounge";
import { BigScreen, Bookshelf, Cooler, Desk, MeetingTable } from "./FurnitureWork";
import { GRID, yawOf } from "./grid";
import { deskOwners, itemCenter, moveItem, type OfficeItem, type OfficeLayout } from "./layout";
import { teamShirts } from "./look";
import { buildNavGrid } from "./pathfinding";
import { officePlaces } from "./places";
import { Room } from "./Room";
import { usePageHidden, useReducedMotion } from "./useMotionPreference";

const TARGET: [number, number, number] = [0, 0.4, 0.6];
const VIEW = { x: 0.6, y: 0.62, z: 0.7 };
/** Seconds between two looks at where the resting agents should drift to next. */
const TICK = 4000;

type OrbitControlsImpl = ComponentRef<typeof OrbitControls>;
type Grab = (item: OfficeItem, event: ThreeEvent<PointerEvent>) => void;

const Piece = memo(function Piece(props: {
  item: OfficeItem;
  lit: boolean;
  glow: boolean;
  onGrab?: Grab;
}) {
  const { item, onGrab } = props;
  const at = itemCenter(item);
  const shape = {
    desk: <Desk id={item.id} lit={props.lit} />,
    sofa: <Sofa id={item.id} />,
    armchair: <Armchair id={item.id} />,
    table: <MeetingTable />,
    "coffee-table": <CoffeeTable />,
    bookshelf: <Bookshelf id={item.id} />,
    screen: <BigScreen />,
    plant: <Plant id={item.id} />,
    lamp: <Lamp glow={props.glow} />,
    cooler: <Cooler />,
    rug: <Rug id={item.id} />,
  }[item.kind];
  return (
    <group
      position={[at.x, 0, at.z]}
      rotation={[0, yawOf(item.rot), 0]}
      onPointerDown={onGrab ? (event) => onGrab(item, event) : undefined}
      onClick={onGrab ? (event) => event.stopPropagation() : undefined}
      onPointerOver={onGrab ? () => (document.body.style.cursor = "grab") : undefined}
      onPointerOut={onGrab ? () => (document.body.style.cursor = "") : undefined}
    >
      {shape}
    </group>
  );
});

/** Sets the camera back far enough to take in the whole room, whatever shape the page is. */
function Framing() {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as OrbitControlsImpl | null;
  const aspect = useThree((state) => state.size.width / Math.max(1, state.size.height));
  const framed = useRef(false);
  useEffect(() => {
    if (framed.current || !controls) return;
    framed.current = true;
    const far = 27 * Math.max(1, 1.9 / aspect);
    const length = Math.hypot(VIEW.x, VIEW.y, VIEW.z);
    camera.position.set(
      TARGET[0] + (VIEW.x / length) * far,
      TARGET[1] + (VIEW.y / length) * far,
      TARGET[2] + (VIEW.z / length) * far,
    );
    controls.update();
  }, [aspect, camera, controls]);
  return null;
}

/** Keeps each name tag, which is ordinary page content laid over the scene, under its figure. */
function TagProjector(props: { anchors: Map<string, Vector3>; tags: Map<string, HTMLElement> }) {
  const point = useMemo(() => new Vector3(), []);
  useFrame(({ camera, size }) => {
    for (const [id, tag] of props.tags) {
      const anchor = props.anchors.get(id);
      if (!anchor) continue;
      point.copy(anchor).project(camera);
      const x = (point.x * 0.5 + 0.5) * size.width;
      const y = (-point.y * 0.5 + 0.5) * size.height;
      tag.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      tag.style.zIndex = String(Math.round((1 - point.z) * 100000));
      tag.style.visibility = point.z < 1 ? "visible" : "hidden";
    }
  });
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

export interface OfficeSceneProps {
  actors: Actor[];
  layout: OfficeLayout;
  selected: string | null;
  onSelect(id: string | null): void;
  building: boolean;
  pickedItem: string | null;
  onPickItem(id: string | null): void;
  onLayout(next: OfficeLayout): void;
}

/**
 * The office itself: the room, its furniture, and a figure for every agent, drawn with three.js.
 * Drag to look around, scroll to come closer, pick a figure to see what it is up to. In build mode
 * the furniture can be dragged from cell to cell instead.
 */
export default function OfficeScene(props: OfficeSceneProps) {
  const { actors, layout, building, onLayout, onPickItem } = props;
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

  const grid = useMemo(() => buildNavGrid(layout.items), [layout.items]);
  const places = useMemo(() => officePlaces(layout.items, grid), [layout.items, grid]);
  const own = useMemo(() => actors.filter((actor) => !actor.guest), [actors]);
  const desks = useMemo(
    () =>
      deskOwners(
        layout.items,
        own.map((actor) => actor.id),
      ),
    [layout.items, own],
  );
  const goals = useMemo(
    () => planGoals(actors, places, desks, tick),
    [actors, places, desks, tick],
  );
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
  const lit = new Set<string>();
  for (const goal of goals.values())
    if (goal.activity === "type") lit.add(goal.spot.id.split(":")[0]!);
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
    <div className="virtual-office-stage">
      <Canvas
        shadows="percentage"
        dpr={[1, 2]}
        frameloop={hidden ? "never" : "always"}
        camera={{ fov: 30, near: 0.5, far: 160, position: [16, 17, 19] }}
        gl={{ antialias: true, alpha: true }}
        onPointerMissed={() => (building ? undefined : props.onSelect(null))}
      >
        <hemisphereLight args={["#fff6e6", "#8f8172", 0.95]} />
        <ambientLight intensity={0.35} />
        <directionalLight
          position={[9, 17, 8]}
          intensity={2.1}
          color="#fff0d8"
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0004}
          shadow-normalBias={0.04}
          shadow-radius={5}
        >
          <orthographicCamera attach="shadow-camera" args={[-15, 15, 12, -12, 1, 50]} />
        </directionalLight>
        <Room />
        {layout.items.map((item) => (
          <Piece
            key={item.id}
            item={item}
            lit={lit.has(item.id)}
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
              onPick={props.onSelect}
            />
          );
        })}
        {building ? (
          <BuildLayer
            items={layout.items}
            picked={props.pickedItem}
            onDrag={dragTo}
            onFloorClick={() => performance.now() - dropped.current > 300 && onPickItem(null)}
          />
        ) : null}
        <OrbitControls
          ref={controls}
          makeDefault
          enabled={!dragging}
          enableDamping={!still}
          dampingFactor={0.12}
          target={TARGET}
          minDistance={6}
          maxDistance={52}
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
        <Framing />
        <Follow id={building ? null : props.selected} anchors={anchors} still={still} />
        <TagProjector anchors={anchors} tags={tags} />
      </Canvas>
      {building ? (
        <div className="virtual-office-tags">
          {desksShown.map((desk) => (
            <div
              key={desk.id}
              className="virtual-office-tag-anchor"
              ref={(node) => {
                if (node) tags.set(`desk:${desk.id}`, node);
                else tags.delete(`desk:${desk.id}`);
              }}
            >
              <span
                className="virtual-office-desk-tag"
                data-free={!deskNames.get(desk.id) || undefined}
              >
                {deskNames.get(desk.id) ?? "Free desk"}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="virtual-office-tags">
          {actors.map((actor) => (
            <div
              key={actor.id}
              className="virtual-office-tag-anchor"
              ref={(node) => {
                if (node) tags.set(actor.id, node);
                else tags.delete(actor.id);
              }}
            >
              <Pressable
                type="button"
                className="virtual-office-tag"
                data-state={actor.state}
                data-selected={props.selected === actor.id || undefined}
                onClick={() => props.onSelect(actor.id)}
              >
                {actor.guest ? `${actor.name} · ${actor.owner}` : actor.name}
              </Pressable>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
