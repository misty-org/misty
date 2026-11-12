import type { ThreeEvent } from "@react-three/fiber";
import { useMemo } from "react";
import { DOOR, GRID } from "./grid";
import { footprint, itemCenter, type StudioItem } from "./layout";
import { FLOOR_MARK } from "./parts";

/** The floor grid drawn as thin lines, one square per cell. */
function GridLines() {
  const points = useMemo(() => {
    const list: number[] = [];
    for (let x = 0; x <= GRID.w; x += 1)
      list.push(x - GRID.w / 2, 0, -GRID.d / 2, x - GRID.w / 2, 0, GRID.d / 2);
    for (let z = 0; z <= GRID.d; z += 1)
      list.push(-GRID.w / 2, 0, z - GRID.d / 2, GRID.w / 2, 0, z - GRID.d / 2);
    return new Float32Array(list);
  }, []);
  return (
    <lineSegments position={[0, FLOOR_MARK, 0]}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[points, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color="#4a3421" transparent opacity={0.45} depthWrite={false} />
    </lineSegments>
  );
}

/**
 * What build mode adds to the room: the grid, a mark under the picked piece, the patch by the
 * door that stays clear, and an unseen sheet over the floor that follows
 * the pointer while a piece is dragged.
 */
export function BuildLayer(props: {
  items: StudioItem[];
  picked: string | null;
  onDrag(event: ThreeEvent<PointerEvent>): void;
  onFloorClick(): void;
}) {
  const picked = props.items.find((item) => item.id === props.picked);
  const size = picked ? footprint(picked) : null;
  const at = picked ? itemCenter(picked) : null;
  return (
    <group>
      <GridLines />
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[1 - GRID.w / 2, FLOOR_MARK + 0.008, DOOR.z - GRID.d / 2]}
      >
        <planeGeometry args={[2, 4]} />
        <meshBasicMaterial color="#4a3421" transparent opacity={0.18} depthWrite={false} />
      </mesh>
      {size && at ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[at.x, FLOOR_MARK + 0.016, at.z]}>
          <planeGeometry args={[size.w + 0.24, size.d + 0.24]} />
          <meshBasicMaterial color="#5fe36b" transparent opacity={0.42} depthWrite={false} />
        </mesh>
      ) : null}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerMove={props.onDrag}
        onClick={(event) => {
          event.stopPropagation();
          props.onFloorClick();
        }}
      >
        <planeGeometry args={[GRID.w + 30, GRID.d + 30]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}
