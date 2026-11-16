import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Vector3, type Group } from "three";
import { hashOf } from "./look";
import { walkView } from "./view";
import { Ball, Box, Cyl } from "./parts";

/*
 * The pieces a studio earns as its team gets work done (studioProgress.ts): every one of them
 * built, like the rest of the room, from a few plain shapes, its front toward +z.
 */

const cabinets = ["#3d3a8f", "#b23a48", "#1f6f78", "#2e2e38"];

/** An arcade cabinet: a tall body, a lit marquee and screen, and a joystick and buttons to play
 * the Space's games on. */
export function Arcade({ id, still }: { id: string; still: boolean }) {
  const body = cabinets[hashOf(id) % cabinets.length]!;
  const screen = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (!screen.current || still) return;
    // The attract screen flickers between two frames, as an idle cabinet's does.
    screen.current.visible = Math.floor(clock.elapsedTime * 1.4) % 4 !== 3;
  });
  return (
    <group position={[0, 0, -0.08]}>
      <Box size={[0.82, 1.62, 0.66]} at={[0, 0.81, -0.04]} color={body} round={0.05} />
      <Box size={[0.86, 0.06, 0.7]} at={[0, 1.64, -0.04]} color="#15151b" round={0.02} />
      <Box
        size={[0.74, 0.2, 0.06]}
        at={[0, 1.5, 0.3]}
        color="#ffd166"
        glow="#ffb703"
        glowPower={1.4}
      />
      <Box
        size={[0.66, 0.5, 0.04]}
        at={[0, 1.12, 0.29]}
        color="#101018"
        turn={[-0.22, 0, 0]}
        shadow={false}
      />
      <group ref={screen}>
        <Box
          size={[0.58, 0.42, 0.01]}
          at={[0, 1.12, 0.316]}
          color="#3fd1ff"
          glow="#28b5e6"
          glowPower={1.2}
          turn={[-0.22, 0, 0]}
          shadow={false}
        />
        {[-0.14, 0.02, 0.16].map((x, index) => (
          <Box
            key={x}
            size={[0.07, 0.07, 0.01]}
            at={[x, 1.08 + index * 0.06, 0.33]}
            color="#ffef9a"
            glow="#ffe066"
            turn={[-0.22, 0, 0]}
            shadow={false}
          />
        ))}
      </group>
      <Box
        size={[0.84, 0.08, 0.3]}
        at={[0, 0.84, 0.36]}
        color="#1d1d24"
        round={0.02}
        turn={[0.18, 0, 0]}
      />
      <Cyl r={0.018} h={0.12} at={[-0.18, 0.93, 0.38]} color="#2a2a30" shadow={false} />
      <Ball r={0.045} at={[-0.18, 1.0, 0.38]} color="#e63946" />
      {[
        [0.06, "#06d6a0"],
        [0.16, "#ffd166"],
        [0.26, "#4cc9f0"],
      ].map(([x, color]) => (
        <Cyl
          key={x as number}
          r={0.03}
          h={0.03}
          at={[x as number, 0.9, 0.38]}
          color={color as string}
          shadow={false}
        />
      ))}
    </group>
  );
}

const beans = ["#e07a5f", "#3d405b", "#81b29a", "#f2cc8f", "#9b5de5"];

/** A beanbag slumped on the floor, a seat as low as it is soft. */
export function Beanbag({ id }: { id: string }) {
  const cloth = beans[hashOf(id) % beans.length]!;
  return (
    <group>
      <Ball r={0.42} at={[0, 0.2, -0.02]} scale={[1, 0.52, 1]} color={cloth} />
      <Ball r={0.3} at={[0, 0.36, -0.2]} scale={[1.2, 0.85, 0.7]} color={cloth} />
    </group>
  );
}

/** A fish tank on its stand, the water lit and a few fish going round in it. */
export function Aquarium({ id, still }: { id: string; still: boolean }) {
  const fish = useRef<Group>(null);
  const seed = hashOf(id);
  useFrame(({ clock }) => {
    if (!fish.current || still) return;
    fish.current.children.forEach((child, index) => {
      const time = clock.elapsedTime * (0.35 + index * 0.08) + index * 2;
      child.position.x = Math.sin(time) * 0.68;
      child.position.y = 0.98 + index * 0.08 + Math.sin(time * 2.3) * 0.03;
      child.rotation.y = Math.cos(time) > 0 ? 0 : Math.PI;
    });
  });
  const colors = ["#ff8c42", "#ffd23f", "#ee4266", "#3bceac"];
  return (
    <group position={[0, 0, -0.1]}>
      <Box size={[1.86, 0.62, 0.62]} at={[0, 0.31, 0]} color="#5a4636" round={0.04} />
      <Box size={[1.8, 0.04, 0.56]} at={[0, 0.66, 0]} color="#d8c8a8" shadow={false} />
      <Box
        size={[1.78, 0.62, 0.54]}
        at={[0, 0.98, 0]}
        color="#7fd3e8"
        glow="#4fb6d6"
        glowPower={0.35}
        opacity={0.42}
        shadow={false}
      />
      <Box size={[1.82, 0.04, 0.58]} at={[0, 1.31, 0]} color="#2b2b30" round={0.015} />
      {[-0.6, -0.2, 0.45].map((x, index) => (
        <Cyl
          key={x}
          r={[0.012, 0.03]}
          h={0.22 + index * 0.06}
          at={[x, 0.79 + index * 0.03, -0.12]}
          color="#3c9a5f"
          shadow={false}
        />
      ))}
      <group ref={fish}>
        {colors.slice(0, 2 + (seed % 3)).map((color, index) => (
          <group key={color} position={[0, 0.98 + index * 0.08, -0.05 + index * 0.07]}>
            <Ball r={0.045} scale={[1.6, 1, 0.6]} at={[0, 0, 0]} color={color} />
            <Box
              size={[0.05, 0.06, 0.01]}
              at={[-0.08, 0, 0]}
              color={color}
              turn={[0, 0, Math.PI / 4]}
              shadow={false}
            />
          </group>
        ))}
      </group>
    </group>
  );
}

/** A shelf for the studio's trophies: one cup for every milestone it has reached. */
export function TrophyShelf({ trophies }: { trophies: number }) {
  const shown = Math.min(9, Math.max(0, trophies));
  return (
    <group position={[0, 0, -0.18]}>
      <Box size={[1.8, 1.4, 0.36]} at={[0, 0.7, -0.08]} color="#6b4f3a" round={0.03} />
      {[0.46, 0.92].map((y) => (
        <Box key={y} size={[1.7, 0.04, 0.4]} at={[0, y, 0]} color="#8a6a4f" shadow={false} />
      ))}
      {Array.from({ length: shown }, (_, index) => {
        const row = Math.floor(index / 3);
        const x = -0.55 + (index % 3) * 0.55;
        const y = [0.08, 0.5, 0.96][row]!;
        const gold = index % 3 === 1 ? "#c0c0c8" : index % 4 === 3 ? "#cd7f32" : "#e9b949";
        return (
          <group key={index} position={[x, y, 0.04]}>
            <Box size={[0.16, 0.05, 0.12]} at={[0, 0.025, 0]} color="#2c2c30" shadow={false} />
            <Cyl r={0.022} h={0.1} at={[0, 0.1, 0]} color={gold} shadow={false} />
            <Cyl r={[0.09, 0.04]} h={0.14} at={[0, 0.22, 0]} color={gold} shadow={false} />
          </group>
        );
      })}
    </group>
  );
}

/** A snack machine: a lit glass front with rows of something to eat behind it. */
export function Vending() {
  const snacks = ["#ef476f", "#ffd166", "#06d6a0", "#118ab2"];
  return (
    <group position={[0, 0, -0.1]}>
      <Box size={[0.86, 1.8, 0.7]} at={[0, 0.9, -0.02]} color="#c1121f" round={0.05} />
      <Box
        size={[0.58, 1.3, 0.02]}
        at={[-0.08, 1.05, 0.34]}
        color="#dff3ff"
        glow="#bfe6ff"
        glowPower={0.5}
        shadow={false}
      />
      {[0, 1, 2, 3].flatMap((row) =>
        [0, 1, 2].map((column) => (
          <Box
            key={`${row}:${column}`}
            size={[0.12, 0.16, 0.04]}
            at={[-0.26 + column * 0.18, 0.55 + row * 0.3, 0.36]}
            color={snacks[(row + column) % snacks.length]!}
            shadow={false}
          />
        )),
      )}
      <Box size={[0.16, 0.5, 0.03]} at={[0.3, 1.2, 0.35]} color="#22222a" shadow={false} />
      <Box size={[0.56, 0.14, 0.03]} at={[-0.08, 0.22, 0.35]} color="#22222a" shadow={false} />
    </group>
  );
}

/** A tree growing indoors in a big pot, taller than anyone in the room. */
export function IndoorTree({ id }: { id: string }) {
  const turn = (hashOf(id) % 6) * 0.5;
  return (
    <group rotation={[0, turn, 0]}>
      <Cyl r={[0.32, 0.25]} h={0.46} at={[0, 0.23, 0]} color="#c8b6a6" />
      <Cyl r={0.29} h={0.03} at={[0, 0.455, 0]} color="#4a3626" shadow={false} />
      <Cyl r={[0.05, 0.08]} h={1.3} at={[0, 1.1, 0]} color="#6f4e37" />
      <Ball r={0.5} at={[0, 1.95, 0]} color="#3f8f4f" facets />
      <Ball r={0.36} at={[0.32, 1.7, 0.1]} color="#4fa35f" facets />
      <Ball r={0.34} at={[-0.3, 1.75, -0.08]} color="#357a43" facets />
      <Ball r={0.28} at={[0.05, 2.32, 0.05]} color="#5bb26b" facets />
    </group>
  );
}

/** An inside wall: as tall as the room's, the same plaster with its trim along the top. */
const INSIDE_WALL = { height: 2.4, thick: 0.18, color: "#f1e9dc", trim: "#d8ccb8" };
/** How fast a wall in the way sinks and rises again. */
const SINK_EASE = 9;

/**
 * A stretch of wall inside the room, four cells long, that parts the studio into rooms; a gap
 * between two is a doorway. Standing between the walking camera and the person's figure, it sinks
 * to a low kerb, as the room's own walls do seen from outside, so the figure is never hidden
 * behind one. Walls ahead of the figure, and every wall while building, stand.
 */
export function InsideWall() {
  const tall = useRef<Group>(null);
  const stands = useRef(1);
  const eye = useMemo(() => new Vector3(), []);
  const target = useMemo(() => new Vector3(), []);
  useFrame(({ camera }, delta) => {
    const wall = tall.current?.parent;
    if (!wall || !tall.current) return;
    let blocks = false;
    if (walkView.active) {
      // The camera and the figure in the wall's own frame, where the wall lies along x at z = 0.
      eye.copy(camera.position);
      wall.worldToLocal(eye);
      target.copy(walkView.target);
      wall.worldToLocal(target);
      const dz = target.z - eye.z;
      if (Math.abs(dz) > 1e-4) {
        // Where the line from the camera to the figure crosses the wall's plane, if it does.
        const t = -eye.z / dz;
        const x = eye.x + (target.x - eye.x) * t;
        const y = eye.y + (target.y - eye.y) * t;
        blocks = t > 0 && t < 1 && Math.abs(x) < 2.3 && y < INSIDE_WALL.height + 0.3;
      }
    }
    const want = blocks ? 0 : 1;
    stands.current += (want - stands.current) * Math.min(1, delta * SINK_EASE);
    if (Math.abs(want - stands.current) < 0.004) stands.current = want;
    tall.current.scale.y = Math.max(0.06, stands.current);
  });
  return (
    <group position={[0, 0, -0.2]}>
      <group ref={tall}>
        <Box
          size={[4, INSIDE_WALL.height, INSIDE_WALL.thick]}
          at={[0, INSIDE_WALL.height / 2, 0]}
          color={INSIDE_WALL.color}
        />
        <Box
          size={[4.02, 0.06, INSIDE_WALL.thick + 0.04]}
          at={[0, INSIDE_WALL.height, 0]}
          color={INSIDE_WALL.trim}
          shadow={false}
        />
      </group>
      <Box
        size={[4, 0.12, INSIDE_WALL.thick + 0.04]}
        at={[0, 0.06, 0]}
        color={INSIDE_WALL.trim}
        shadow={false}
      />
    </group>
  );
}
