import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Group } from "three";
import { DOOR, type RoomSize } from "./grid";
import { Box } from "./parts";

const WALL = { height: 2.7, thick: 0.22, color: "#f1e9dc", trim: "#d8ccb8" };

/** Floorboards drawn on a canvas: rows of planks in a few close tones, with staggered ends. */
function useFloorboards(size: RoomSize): CanvasTexture {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 512;
    const pen = canvas.getContext("2d");
    const tones = ["#d2ad7c", "#cba473", "#d8b587", "#c69d6b", "#d4b081"];
    if (pen) {
      for (let row = 0; row < 8; row += 1) {
        let x = -((row * 173) % 256);
        let plank = row;
        while (x < 512) {
          const length = 192 + ((plank * 67) % 128);
          pen.fillStyle = tones[(plank * 3 + row) % tones.length]!;
          pen.fillRect(x, row * 64, length, 64);
          pen.fillStyle = "rgba(90, 60, 30, 0.28)";
          pen.fillRect(x, row * 64, 2, 64);
          x += length;
          plank += 1;
        }
        pen.fillStyle = "rgba(90, 60, 30, 0.3)";
        pen.fillRect(0, row * 64, 512, 2);
      }
    }
    const made = new CanvasTexture(canvas);
    made.wrapS = made.wrapT = RepeatWrapping;
    made.colorSpace = SRGBColorSpace;
    made.anisotropy = 8;
    return made;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  texture.repeat.set(size.w / 4, size.d / 4);
  return texture;
}

function Window({ x }: { x: number }) {
  return (
    <group position={[x, 1.5, WALL.thick / 2]}>
      <Box size={[2.3, 1.35, 0.06]} at={[0, 0, 0]} color="#fbf7ef" shadow={false} />
      <Box
        size={[2.1, 1.15, 0.07]}
        at={[0, 0, 0.005]}
        color="#bfe1f2"
        glow="#a9d8f0"
        glowPower={0.55}
        shadow={false}
      />
      <Box size={[0.05, 1.15, 0.09]} at={[0, 0, 0.01]} color="#fbf7ef" shadow={false} />
      <Box size={[2.1, 0.05, 0.09]} at={[0, 0.1, 0.01]} color="#fbf7ef" shadow={false} />
      <Box
        size={[2.4, 0.06, 0.2]}
        at={[0, -0.7, 0.07]}
        color="#fbf7ef"
        round={0.02}
        shadow={false}
      />
    </group>
  );
}

function Picture(props: {
  at: [number, number, number];
  size: [number, number];
  paint: string;
  sun: string;
}) {
  const [w, h] = props.size;
  return (
    <group position={props.at}>
      <Box size={[w, h, 0.05]} at={[0, 0, 0]} color="#5b4636" shadow={false} />
      <Box size={[w - 0.1, h - 0.1, 0.066]} at={[0, 0, 0]} color={props.paint} shadow={false} />
      <Box
        size={[w * 0.3, h * 0.3, 0.082]}
        at={[w * 0.12, h * 0.1, 0]}
        color={props.sun}
        round={0.02}
        shadow={false}
      />
    </group>
  );
}

/** The door the agents wait by, set into the left wall, with its mat. */
function Door({ depth }: { depth: number }) {
  const z = DOOR.z - depth / 2;
  return (
    <group position={[0.01, 0, z]} rotation={[0, Math.PI / 2, 0]}>
      <Box size={[1.5, 2.2, 0.08]} at={[0, 1.1, 0]} color="#fbf7ef" shadow={false} />
      <Box size={[1.26, 2.05, 0.1]} at={[0, 1.03, 0.01]} color="#b9774a" shadow={false} />
      <Box
        size={[0.95, 0.75, 0.11]}
        at={[0, 1.5, 0.015]}
        color="#c58556"
        round={0.03}
        shadow={false}
      />
      <Box
        size={[0.95, 0.75, 0.11]}
        at={[0, 0.55, 0.015]}
        color="#c58556"
        round={0.03}
        shadow={false}
      />
      <Box
        size={[0.07, 0.07, 0.1]}
        at={[0.48, 1.05, 0.08]}
        color="#e9c46a"
        round={0.03}
        shadow={false}
      />
      <Box
        size={[1.5, 0.03, 0.95]}
        at={[0, 0.015, 0.7]}
        color="#6d8f6b"
        round={0.012}
        shadow={false}
      />
      <Box
        size={[1.26, 0.038, 0.71]}
        at={[0, 0.019, 0.7]}
        color="#89a886"
        round={0.012}
        shadow={false}
      />
    </group>
  );
}

/** How fast a wall sinks and rises, as a share of the way per second. */
const WALL_EASE = 9;

/** One wall. It stands while the camera is on its inner side; seen from behind it sinks to a low
 * kerb, so the room is always open toward whoever looks at it. It sinks and rises smoothly. */
function Wall(props: {
  at: [number, number];
  turn: number;
  length: number;
  out: [number, number];
  children?: React.ReactNode;
}) {
  const tall = useRef<Group>(null);
  const stands = useRef(1);
  useFrame(({ camera }, delta) => {
    const behind =
      (camera.position.x - props.at[0]) * props.out[0] +
        (camera.position.z - props.at[1]) * props.out[1] >
      0;
    const want = behind ? 0 : 1;
    stands.current += (want - stands.current) * Math.min(1, delta * WALL_EASE);
    if (Math.abs(want - stands.current) < 0.004) stands.current = want;
    if (!tall.current) return;
    tall.current.visible = stands.current > 0.02;
    tall.current.scale.y = Math.max(0.02, stands.current);
  });
  return (
    <group position={[props.at[0], 0, props.at[1]]} rotation={[0, props.turn, 0]}>
      <group ref={tall}>
        <Box
          size={[props.length, WALL.height, WALL.thick]}
          at={[0, WALL.height / 2, 0]}
          color={WALL.color}
          shadow={false}
        />
        <Box
          size={[props.length, 0.08, WALL.thick + 0.06]}
          at={[0, WALL.height + 0.04, 0]}
          color={WALL.trim}
          shadow={false}
        />
        {props.children}
      </group>
      <Box
        size={[props.length, 0.16, WALL.thick + 0.04]}
        at={[0, 0.08, 0]}
        color={WALL.trim}
        shadow={false}
      />
    </group>
  );
}

/** Where windows go along a wall: evenly, about one every seven units, clear of its ends. */
function windowsAlong(length: number): number[] {
  const count = Math.max(1, Math.round(length / 7));
  const gap = length / count;
  return Array.from({ length: count }, (_, index) => -length / 2 + gap * (index + 0.5));
}

/** The shell of the studio: a slab it stands on, the wooden floor, and four walls with windows,
 * pictures and the door. Everything is measured from the room's size, so it grows with it. */
export function Room({ size }: { size: RoomSize }) {
  const boards = useFloorboards(size);
  const half = { w: size.w / 2, d: size.d / 2 };
  const edge = WALL.thick / 2;
  const long = size.w + WALL.thick * 2;
  return (
    <group>
      <Box
        size={[size.w + 1.1, 0.5, size.d + 1.1]}
        at={[0, -0.27, 0]}
        color="#2b2826"
        round={0.12}
        shadow={false}
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[size.w, size.d]} />
        <meshStandardMaterial map={boards} roughness={0.75} />
      </mesh>
      <Wall at={[0, -half.d - edge]} turn={0} length={long} out={[0, -1]}>
        {windowsAlong(size.w).map((x) => (
          <Window key={x} x={x} />
        ))}
      </Wall>
      <Wall at={[0, half.d + edge]} turn={Math.PI} length={long} out={[0, 1]}>
        {windowsAlong(size.w - 6).map((x) => (
          <Window key={x} x={x} />
        ))}
      </Wall>
      <Wall at={[-half.w - edge, 0]} turn={Math.PI / 2} length={size.d} out={[-1, 0]}>
        <Picture at={[3.6, 1.6, edge + 0.02]} size={[1.1, 0.8]} paint="#e9d8a6" sun="#ee9b00" />
        <Picture at={[2.3, 1.75, edge + 0.02]} size={[0.6, 0.6]} paint="#94d2bd" sun="#0a9396" />
        <group position={[0, 0, edge]} rotation={[0, -Math.PI / 2, 0]}>
          <Door depth={size.d} />
        </group>
      </Wall>
      <Wall at={[half.w + edge, 0]} turn={-Math.PI / 2} length={size.d} out={[1, 0]}>
        <Picture at={[0, 1.6, edge + 0.02]} size={[1.6, 0.9]} paint="#cfe1b9" sun="#718355" />
        <Picture at={[-3, 1.7, edge + 0.02]} size={[0.8, 0.8]} paint="#f4c7ab" sun="#bb3e03" />
      </Wall>
    </group>
  );
}
