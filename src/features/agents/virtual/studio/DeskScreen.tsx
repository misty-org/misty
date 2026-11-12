import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group } from "three";
import type { Actor } from "./behaviour";
import { Box } from "./parts";

/**
 * What a desk's monitor shows: the kind of work its agent is doing, that it is waiting for its
 * person, or how its last run ended. Nothing on it is read from the work itself, only the fixed
 * kind, so a screen never shows a page, a file or a command.
 */
export type ScreenKind =
  | "terminal"
  | "browser"
  | "files"
  | "notes"
  | "apps"
  | "agents"
  | "thinking"
  | "waiting"
  | "done"
  | "failed";

/** What an agent's desk monitor shows: its work, that it waits for its person, or how it ended. */
export function screenOf(actor: Actor): ScreenKind | null {
  if (actor.state === "working") return screenFor(actor.doingCode);
  if (actor.state === "needs-you") return "waiting";
  if (actor.outcome === "done") return "done";
  if (actor.outcome === "failed") return "failed";
  return null;
}

/** The screen a run's kind of work puts up. */
export function screenFor(doingCode: string): ScreenKind {
  if (doingCode === "shell") return "terminal";
  if (doingCode === "browser" || doingCode === "web" || doingCode === "computer") return "browser";
  if (doingCode === "files") return "files";
  if (doingCode === "space") return "notes";
  if (doingCode === "app") return "apps";
  if (doingCode === "agents") return "agents";
  return "thinking";
}

/** The screen's face: where it is on the desk, how big, and a clear step in front of the glass. */
const FACE = { x: 0, y: 1.0, z: -0.702, w: 0.71, h: 0.39 };
/** How far in front of other content anything lying over it stands, so the two never flicker. */
const OVER = 0.006;
const at = (x: number, y: number, over = 0): [number, number, number] => [
  FACE.x + x,
  FACE.y + y,
  FACE.z + over * OVER,
];

const looks: Record<ScreenKind, { color: string; glow: string }> = {
  terminal: { color: "#0d1712", glow: "#123321" },
  browser: { color: "#f4f6fa", glow: "#c9d7ee" },
  files: { color: "#f6f3ec", glow: "#ddd6c6" },
  notes: { color: "#2a2f3a", glow: "#1d2230" },
  apps: { color: "#1d2431", glow: "#1a2540" },
  agents: { color: "#1d2431", glow: "#1a2540" },
  thinking: { color: "#18233a", glow: "#1d3157" },
  waiting: { color: "#3a2a06", glow: "#7a5207" },
  done: { color: "#0f2a17", glow: "#1d6b35" },
  failed: { color: "#2e0f10", glow: "#7a1b1e" },
};

/** Lines of output scrolling up a terminal: each moves up a line now and then, and the one that
 * leaves the top comes back in at the bottom as the newest. */
function Terminal({ still }: { still: boolean }) {
  const lines = useRef<Group>(null);
  const widths = [0.42, 0.28, 0.5, 0.2, 0.36];
  useFrame(({ clock }) => {
    if (!lines.current) return;
    const step = still ? 0 : Math.floor(clock.elapsedTime * 2.2);
    lines.current.children.forEach((line, index) => {
      const row = (index - step + widths.length * 1000) % widths.length;
      line.position.y = 0.13 - row * 0.065;
    });
  });
  return (
    <group>
      <group ref={lines}>
        {widths.map((width, index) => (
          <group key={index}>
            <Box
              size={[width, 0.022, 0.006]}
              at={[FACE.x - 0.3 + width / 2, FACE.y, FACE.z]}
              color={index % 3 === 0 ? "#9be7a6" : "#4fbf6a"}
              glow={index % 3 === 0 ? "#9be7a6" : "#4fbf6a"}
              glowPower={0.8}
              shadow={false}
            />
          </group>
        ))}
      </group>
      <Blink at={at(-0.27, -0.16)} size={[0.035, 0.03]} color="#9be7a6" still={still} />
    </group>
  );
}

/** Something that blinks on and off, like a text cursor. */
function Blink(props: {
  at: [number, number, number];
  size: [number, number];
  color: string;
  still: boolean;
}) {
  const mark = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (mark.current) mark.current.visible = props.still || clock.elapsedTime % 1 < 0.55;
  });
  return (
    <group ref={mark}>
      <Box
        size={[props.size[0], props.size[1], 0.006]}
        at={props.at}
        color={props.color}
        glow={props.color}
        glowPower={0.9}
        shadow={false}
      />
    </group>
  );
}

/** A web page: its bar along the top, a picture, and lines of text. */
function Browser() {
  return (
    <>
      <Box size={[0.71, 0.05, 0.006]} at={at(0, 0.17)} color="#d9dee8" shadow={false} />
      <Box size={[0.36, 0.022, 0.007]} at={at(0.02, 0.17, 1)} color="#ffffff" shadow={false} />
      <Box size={[0.28, 0.16, 0.007]} at={at(-0.17, 0.03)} color="#7aa3e0" shadow={false} />
      {[0.08, 0.03, -0.02].map((y) => (
        <Box key={y} size={[0.24, 0.02, 0.007]} at={at(0.17, y)} color="#aab3c3" shadow={false} />
      ))}
      {[-0.1, -0.14].map((y) => (
        <Box key={y} size={[0.6, 0.018, 0.007]} at={at(0, y)} color="#c4cbd8" shadow={false} />
      ))}
    </>
  );
}

/** A document being written: its lines, and the cursor at the end of the last one. */
function Files({ still }: { still: boolean }) {
  const widths = [0.46, 0.52, 0.38, 0.5, 0.22];
  return (
    <>
      <Box size={[0.13, 0.39, 0.006]} at={at(-0.29, 0)} color="#e3ddd0" shadow={false} />
      {widths.map((width, index) => (
        <Box
          key={index}
          size={[width, 0.022, 0.007]}
          at={at(-0.19 + width / 2, 0.13 - index * 0.06)}
          color={index === 2 ? "#d9a441" : "#8f8a80"}
          shadow={false}
        />
      ))}
      <Blink at={at(0.05, -0.11)} size={[0.012, 0.04]} color="#30302c" still={still} />
    </>
  );
}

/** Notes pinned up in the Space. */
function Notes() {
  const notes = ["#ffd166", "#f4978e", "#a8dadc", "#cdb4db", "#b5e48c", "#ffd166"];
  return (
    <>
      {notes.map((color, index) => (
        <Box
          key={index}
          size={[0.17, 0.13, 0.007]}
          at={at(-0.21 + (index % 3) * 0.21, 0.08 - Math.floor(index / 3) * 0.17)}
          color={color}
          glow={color}
          glowPower={0.25}
          shadow={false}
        />
      ))}
    </>
  );
}

/** A grid of apps, one of them open. */
function Apps() {
  const tiles = [
    "#4d9de0",
    "#e15554",
    "#3bb273",
    "#e1bc29",
    "#7768ae",
    "#f08a4b",
    "#2ec4b6",
    "#ef476f",
  ];
  return (
    <>
      {tiles.map((color, index) => (
        <Box
          key={index}
          size={[0.1, 0.1, 0.007]}
          at={at(-0.24 + (index % 4) * 0.16, 0.08 - Math.floor(index / 4) * 0.16)}
          color={color}
          glow={color}
          glowPower={index === 2 ? 0.9 : 0.3}
          shadow={false}
        />
      ))}
    </>
  );
}

/** Two agents and the line between them, while one works with another. */
function Agents({ still }: { still: boolean }) {
  return (
    <>
      <Box
        size={[0.1, 0.1, 0.007]}
        at={at(-0.16, 0)}
        color="#7aa3e0"
        glow="#7aa3e0"
        shadow={false}
      />
      <Box
        size={[0.1, 0.1, 0.007]}
        at={at(0.16, 0)}
        color="#b39ddb"
        glow="#b39ddb"
        shadow={false}
      />
      <Box size={[0.2, 0.014, 0.007]} at={at(0, 0)} color="#5c6a85" shadow={false} />
      <Blink at={at(0, 0, 1)} size={[0.03, 0.03]} color="#e6edf7" still={still} />
    </>
  );
}

/** Three dots that take turns, while it thinks. */
function Thinking({ still }: { still: boolean }) {
  const dots = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (!dots.current) return;
    dots.current.children.forEach((dot, index) => {
      const lift = still ? 0 : Math.max(0, Math.sin(clock.elapsedTime * 5 - index * 0.9));
      dot.position.y = lift * 0.03;
    });
  });
  return (
    <group ref={dots}>
      {[-0.08, 0, 0.08].map((x) => (
        <group key={x}>
          <Box
            size={[0.045, 0.045, 0.007]}
            at={at(x, 0)}
            color="#8fb4ff"
            glow="#8fb4ff"
            glowPower={0.9}
            round={0.02}
            shadow={false}
          />
        </group>
      ))}
    </group>
  );
}

/** A big sign in the middle of the screen: !, a check or a cross. */
function Sign({ kind }: { kind: "waiting" | "done" | "failed" }) {
  const color = { waiting: "#ffc23d", done: "#5fe36b", failed: "#ff6b6b" }[kind];
  const bar = (size: [number, number], x: number, y: number, z = 0) => (
    <Box
      size={[size[0], size[1], 0.008]}
      at={at(x, y)}
      turn={[0, 0, z]}
      color={color}
      glow={color}
      glowPower={1}
      round={0.008}
      shadow={false}
    />
  );
  if (kind === "waiting")
    return (
      <>
        {bar([0.04, 0.15], 0, 0.04)}
        {bar([0.04, 0.04], 0, -0.1)}
      </>
    );
  if (kind === "done")
    return (
      <>
        {bar([0.04, 0.1], -0.05, -0.03, 0.75)}
        {bar([0.04, 0.22], 0.04, 0.02, -0.6)}
      </>
    );
  return (
    <>
      {bar([0.04, 0.24], 0, 0, 0.78)}
      {bar([0.04, 0.24], 0, 0, -0.78)}
    </>
  );
}

/** The glass and what is on it; dark when nobody is at work there. */
export function DeskScreen({ kind, still }: { kind: ScreenKind | null; still: boolean }) {
  if (!kind)
    return (
      <Box
        size={[FACE.w, FACE.h, 0.012]}
        at={[FACE.x, FACE.y, -0.714]}
        color="#171a20"
        shadow={false}
      />
    );
  const look = looks[kind];
  return (
    <>
      <Box
        size={[FACE.w, FACE.h, 0.012]}
        at={[FACE.x, FACE.y, -0.714]}
        color={look.color}
        glow={look.glow}
        glowPower={0.9}
        shadow={false}
      />
      {kind === "terminal" ? <Terminal still={still} /> : null}
      {kind === "browser" ? <Browser /> : null}
      {kind === "files" ? <Files still={still} /> : null}
      {kind === "notes" ? <Notes /> : null}
      {kind === "apps" ? <Apps /> : null}
      {kind === "agents" ? <Agents still={still} /> : null}
      {kind === "thinking" ? <Thinking still={still} /> : null}
      {kind === "waiting" || kind === "done" || kind === "failed" ? <Sign kind={kind} /> : null}
    </>
  );
}
