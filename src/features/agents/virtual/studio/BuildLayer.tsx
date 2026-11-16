import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { CanvasTexture, RepeatWrapping } from "three";
import { DOOR, GRID } from "./grid";
import { footprint, itemCenter, type StudioItem } from "./layout";
import { FLOOR_MARK } from "./parts";

/** One cell's edge, drawn on a small canvas and repeated over the floor. */
function useCellTexture(): CanvasTexture {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const pen = canvas.getContext("2d");
    if (pen) {
      pen.fillStyle = "rgba(74, 52, 33, 0.5)";
      pen.fillRect(0, 0, 64, 2);
      pen.fillRect(0, 0, 2, 64);
    }
    const made = new CanvasTexture(canvas);
    made.wrapS = made.wrapT = RepeatWrapping;
    made.anisotropy = 8;
    return made;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

/**
 * The floor grid, one square per cell. It is a texture rather than lines: a texture is smoothed
 * as it gets smaller with distance, where hairlines a pixel wide shimmer as the camera moves.
 */
function GridLines() {
  const texture = useCellTexture();
  texture.repeat.set(GRID.w, GRID.d);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_MARK, 0]}>
      <planeGeometry args={[GRID.w, GRID.d]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
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
